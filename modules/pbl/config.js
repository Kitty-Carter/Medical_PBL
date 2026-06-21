const path = require('path');

function toBool(v, fallback = false) {
  if (v == null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseApiKeys() {
  const list = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !list.includes(s)) list.push(s);
  };
  const legacy = process.env.LONGCAI_API_KEY || '';
  const primary = process.env.LONGCAT_API_KEY || legacy;
  const backup = process.env.LONGCAT_API_KEY_BACKUP || '';
  const group = String(process.env.LONGCAT_API_KEYS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  push(primary);
  group.forEach(push);
  push(backup);
  return list;
}

const pblConfig = {
  longcatApiKey: process.env.LONGCAT_API_KEY || process.env.LONGCAI_API_KEY || '',
  longcatApiKeys: parseApiKeys(),
  longcatBaseUrl: process.env.LONGCAT_BASE_URL || 'https://api.longcat.chat/openai',
  longcatChatPath: process.env.LONGCAT_CHAT_COMPLETIONS_PATH || '/v1/chat/completions',
  modelRole: process.env.LONGCAT_MODEL_ROLE || process.env.LONGCAT_MODEL_LITE || 'LongCat-Flash-Lite',
  modelLite: process.env.LONGCAT_MODEL_LITE || process.env.LONGCAT_MODEL_ROLE || 'LongCat-Flash-Lite',
  modelThinking: process.env.LONGCAT_MODEL_THINKING || 'LongCat-Flash-Thinking-2601',
  modelPolicy: process.env.PBL_MODEL_POLICY || 'smart',
  chunkedSend: toBool(process.env.PBL_CHUNKED_SEND, true),
  chunkMinIntervalMs: toNum(process.env.PBL_CHUNK_MIN_INTERVAL_MS, 320),
  chunkMaxIntervalMs: toNum(process.env.PBL_CHUNK_MAX_INTERVAL_MS, 850),
  debug: toBool(process.env.PBL_DEBUG, false),
  evidenceTopK: toNum(process.env.PBL_EVIDENCE_TOPK, 5),
  evalThreshold: toNum(process.env.PBL_EVAL_THRESHOLD, 7),
  evidenceIndexPath: path.join(__dirname, '..', '..', 'databases', '.pbl_evidence_index.json'),
  databasesDir: path.join(__dirname, '..', '..', 'databases'),
  lessonSummaryDir: path.join(__dirname, '..', '..', 'databases', 'lesson_summaries'),
  requestTimeoutMs: toNum(process.env.PBL_REQUEST_TIMEOUT_MS, 30000),
  max429Retries: toNum(process.env.PBL_429_MAX_RETRIES, 4),
  webRelayEnabled: toBool(process.env.PBL_WEB_RELAY_ENABLED, false),
  webRelayTimeoutMs: toNum(process.env.PBL_WEB_RELAY_TIMEOUT_MS, 90000),
  webRelayMaxConcurrent: toNum(process.env.PBL_WEB_RELAY_MAX_CONCURRENT, 2),
  webRelayMaxSessions: toNum(process.env.PBL_WEB_RELAY_MAX_SESSIONS, 4),
  webRelayRoomMinIntervalMs: toNum(process.env.PBL_WEB_RELAY_ROOM_MIN_INTERVAL_MS, 500),
  webRelayBreakerThreshold: toNum(process.env.PBL_WEB_RELAY_BREAKER_THRESHOLD, 4),
  webRelayBreakerCooldownMs: toNum(process.env.PBL_WEB_RELAY_BREAKER_COOLDOWN_MS, 120000),
  providerPolicy: String(process.env.PBL_PROVIDER_POLICY || 'longcat_only').toLowerCase(),
};

module.exports = {
  pblConfig,
};
