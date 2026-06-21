const axios = require('axios');
const { withRateLimitRetry } = require('./retry');
const { pblConfig } = require('./config');

function trimCodeFence(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : raw;
}

function extractFirstJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') inStr = true;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return '';
}

function sanitizeJsonLike(text) {
  let s = String(text || '').trim();
  s = trimCodeFence(s);
  const firstObj = extractFirstJsonObject(s);
  if (firstObj) s = firstObj;
  s = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\u0000/g, '')
    .trim();
  return s;
}

function safeJsonParse(text) {
  const cleaned = sanitizeJsonLike(text);
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    try {
      const singleQuoteHeuristic = cleaned
        .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*?)'(\s*[,}])/g, ':"$1"$2');
      return JSON.parse(singleQuoteHeuristic);
    } catch (_) {}
    return null;
  }
}

class LongcatClient {
  constructor(config = pblConfig) {
    this.config = config;
    this.chatUrl = `${config.longcatBaseUrl}${config.longcatChatPath}`;
    this.apiKeys = Array.isArray(config.longcatApiKeys) && config.longcatApiKeys.length
      ? config.longcatApiKeys
      : [config.longcatApiKey].filter(Boolean);
  }

  enabled() {
    return this.apiKeys.length > 0;
  }

  keyFingerprint(key) {
    const s = String(key || '');
    if (!s) return '(empty)';
    return `${s.slice(0, 6)}***${s.slice(-4)}`;
  }

  async chat({
    model,
    messages,
    temperature = 0.6,
    max_tokens = 1400,
    response_format,
    timeoutMs,
    tag = 'chat',
    allow_fallback = true,
    fallback_model,
    preferred_model,
    model_routing_stage = 'unknown',
  }) {
    if (!this.enabled()) {
      const e = new Error('LONGCAT_API_KEY 未配置');
      e.type = 'config_error';
      throw e;
    }
    const started = Date.now();
    let retries = 0;
    const invokeOnce = async (chosenModel, apiKey, keyIndex = 0) => {
      const res = await withRateLimitRetry(
        async () => {
          return axios.post(
            this.chatUrl,
            {
              model: chosenModel,
              messages,
              temperature,
              max_tokens,
              response_format,
            },
            {
              timeout: timeoutMs || this.config.requestTimeoutMs,
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          );
        },
        {
          maxRetries: this.config.max429Retries,
          onRetry: ({ reason }) => {
            retries += 1;
            if (this.config.debug) {
              console.log(`[PBL][Longcat][Retry] tag=${tag} reason=${reason} retry#${retries}`);
            }
          },
        }
      );
      const content = res.data?.choices?.[0]?.message?.content || '';
      const usage = res.data?.usage || {};
      const responseId = res.data?.id || '';
      const actualModel = res.data?.model || chosenModel;
      return { content: String(content).trim(), usage, responseId, actualModel, raw: res.data, keyIndex };
    };

    const chosen = model || preferred_model || this.config.modelRole;
    let result;
    let modelFallback = false;
    let modelFallbackReason = '';
    let apiCallAttempted = false;
    let apiCallSucceeded = false;
    let apiKeyIndexUsed = -1;
    let apiKeyFallback = false;
    let apiKeyFallbackReason = '';
    const tryWithKey = async (keyIndex, chosenModel) => {
      apiCallAttempted = true;
      const key = this.apiKeys[keyIndex];
      const r = await invokeOnce(chosenModel, key, keyIndex);
      apiCallSucceeded = true;
      apiKeyIndexUsed = keyIndex;
      return r;
    };
    try {
      result = await tryWithKey(0, chosen);
    } catch (e) {
      const msg = String(e?.response?.data?.error?.message || e?.message || '').toLowerCase();
      const quotaErr = /quota|insufficient|exhausted/.test(msg);
      const rateErr = e?.response?.status === 429;
      const timeoutErr = /timeout|timed out|etimedout/.test(msg);
      const authErr = e?.response?.status === 401 || /invalid api key|unauthorized/.test(msg);
      const canSwitchKey = this.apiKeys.length > 1 && (quotaErr || authErr);
      if (canSwitchKey) {
        apiKeyFallback = true;
        apiKeyFallbackReason = quotaErr ? 'primary_quota_exhausted' : 'primary_key_invalid';
        if (this.config.debug) {
          console.log(`[PBL][Longcat][KeyFallback] from=${this.keyFingerprint(this.apiKeys[0])} to=${this.keyFingerprint(this.apiKeys[1])} reason=${apiKeyFallbackReason}`);
        }
        try {
          result = await tryWithKey(1, chosen);
        } catch (e2) {
          if (allow_fallback && fallback_model && fallback_model !== chosen) {
            modelFallback = true;
            modelFallbackReason = quotaErr ? 'quota_exhausted' : (rateErr ? '429' : (timeoutErr ? 'timeout' : 'provider_error'));
            result = await tryWithKey(1, fallback_model);
          } else {
            throw e2;
          }
        }
      } else if (allow_fallback && fallback_model && fallback_model !== chosen) {
        modelFallback = true;
        modelFallbackReason = quotaErr ? 'quota_exhausted' : (rateErr ? '429' : (timeoutErr ? 'timeout' : 'provider_error'));
        result = await tryWithKey(0, fallback_model);
      } else {
        throw e;
      }
    }
    const elapsedMs = Date.now() - started;
    if (this.config.debug) {
      console.log(`[PBL][Longcat] tag=${tag} preferred=${preferred_model || model || ''} actual=${result.actualModel} fallback=${modelFallback} elapsed=${elapsedMs}ms retries=${retries} usage=${JSON.stringify(result.usage)}`);
    }
    return {
      content: result.content,
      usage: result.usage,
      responseId: result.responseId,
      actualModel: result.actualModel,
      elapsedMs,
      retries,
      modelFallback,
      modelFallbackReason,
      apiKeyFallback,
      apiKeyFallbackReason,
      apiKeyIndexUsed,
      apiCallAttempted,
      apiCallSucceeded,
      preferredModel: preferred_model || model || '',
      requestedModel: chosen,
      providerResolvedModel: result.actualModel,
      modelRoutingStage: model_routing_stage,
    };
  }

  async chatJson(payload) {
    const result = await this.chat(payload);
    const parsed = safeJsonParse(result.content);
    return { ...result, parsed };
  }
}

module.exports = {
  LongcatClient,
  safeJsonParse,
  sanitizeJsonLike,
};
