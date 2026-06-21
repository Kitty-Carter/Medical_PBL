// DeepSeek API 客户端 - 完整重写版本
const OpenAI = require('openai');
const config = require('../config/config');

class DeepSeekClient {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.deepseek.apiKey,
      baseURL: config.deepseek.baseURL,
      timeout: 70000,
      maxRetries: 0,
    });
  }

  async chat({
    model,
    messages,
    responseFormat = null,
    temperature = 0.7,
    maxTokens = 4000,
    tag = 'unknown',
    abortSignal = null,
  }) {
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt < config.deepseek.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this._calculateBackoff(attempt);
          console.log(`[DeepSeek][Retry] attempt=${attempt + 1} delay=${delay}ms tag=${tag}`);
          await this._sleep(delay);
        }

        const messagesWithJsonContract = this._enforceJsonContract(messages, responseFormat);

        const params = {
          model,
          messages: messagesWithJsonContract,
          temperature,
          max_tokens: maxTokens,
        };

        if (responseFormat) {
          params.response_format = responseFormat;
        }

        if (abortSignal) {
          params.signal = abortSignal;
        }

        const completion = await this.client.chat.completions.create(params);

        const elapsed = Date.now() - startTime;
        
        // DeepSeek reasoner 返回 reasoning_content（思考过程）+ content（最终输出）
        // 我们只需要 content
        const message = completion.choices[0]?.message;
        const content = message?.content || '';
        
        // 如果 content 为空，打印调试信息
        if (!content && model === 'deepseek-reasoner') {
          console.warn(`[DeepSeek][Reasoner] content为空 tag=${tag}`);
          const reasoningLength = message?.reasoning_content?.length || 0;
          console.warn(`[DeepSeek][Reasoner] reasoning_content长度: ${reasoningLength}`);
        }
        
        const usage = completion.usage || {};

        console.log(`[DeepSeek][Success] model=${model} elapsed=${elapsed}ms tokens=${usage.total_tokens || 0} contentLength=${content.length} tag=${tag}`);

        return {
          content,
          usage: {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          },
          model: completion.model || model,
          finishReason: completion.choices[0]?.finish_reason,
        };
      } catch (error) {
        lastError = error;
        const status = error?.status || error?.response?.status;

        if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
          throw new Error('Request aborted by user');
        }

        if (status === 402) {
          throw new Error(`DeepSeek 余额不足 (402): ${error.message}`);
        }

        if (status === 429 || status === 500 || status === 503) {
          console.warn(`[DeepSeek][RetryableError] status=${status} attempt=${attempt + 1}/${config.deepseek.maxRetries} tag=${tag}`);
          continue;
        }

        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          console.warn(`[DeepSeek][Timeout] attempt=${attempt + 1}/${config.deepseek.maxRetries} tag=${tag}`);
          if (attempt < config.deepseek.maxRetries - 1) continue;
        }

        throw error;
      }
    }

    throw new Error(`DeepSeek API 调用失败（重试${config.deepseek.maxRetries}次后）: ${lastError.message}`);
  }

  _enforceJsonContract(messages, responseFormat) {
    if (!responseFormat || responseFormat.type !== 'json_object') {
      return messages;
    }

    const jsonOnlyInstruction = '\n\n【严格约束】你必须且只能输出有效的JSON对象，不得包含任何解释、前缀、后缀、markdown代码块、思考过程或其他文本。直接以{开始，以}结束。';

    return messages.map((msg, idx) => {
      if (msg.role === 'system' && idx === 0) {
        return { ...msg, content: msg.content + jsonOnlyInstruction };
      }
      return msg;
    });
  }

  _calculateBackoff(attempt) {
    const base = config.deepseek.retryDelayBase;
    const max = config.deepseek.retryDelayMax;
    const exponential = base * Math.pow(2, attempt);
    const jitter = Math.random() * base;
    return Math.min(exponential + jitter, max);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { DeepSeekClient };
