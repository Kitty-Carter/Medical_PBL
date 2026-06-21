function toBool(v, fallback) {
  if (v == null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowHour() {
  return new Date().getHours();
}

const relayConfig = {
  enabled: toBool(process.env.PBL_DEEPSEEK_WEB_ENABLED, true),
  baseUrl: process.env.PBL_DEEPSEEK_WEB_URL || 'https://chat.deepseek.com',
  headless: toBool(process.env.PBL_DEEPSEEK_WEB_HEADLESS, true),
  globalConcurrency: toNum(process.env.PBL_DEEPSEEK_WEB_GLOBAL_CONCURRENCY, 3),
  roomDebounceMs: toNum(process.env.PBL_DEEPSEEK_WEB_DEBOUNCE_MS, 3500),
  jobTtlMs: toNum(process.env.PBL_DEEPSEEK_WEB_JOB_TTL_MS, 180000),
  queueMaxSize: toNum(process.env.PBL_DEEPSEEK_WEB_QUEUE_MAX, 120),
  cooldownDayMs: toNum(process.env.PBL_DEEPSEEK_WEB_COOLDOWN_DAY_MS, 4000),
  cooldownNightMs: toNum(process.env.PBL_DEEPSEEK_WEB_COOLDOWN_NIGHT_MS, 9000),
  cooldownDayStartHour: toNum(process.env.PBL_DEEPSEEK_WEB_DAY_START_HOUR, 8),
  cooldownNightStartHour: toNum(process.env.PBL_DEEPSEEK_WEB_NIGHT_START_HOUR, 23),
  allowHighPriorityBypassCooldown: toBool(process.env.PBL_DEEPSEEK_WEB_BYPASS_COOLDOWN, true),
  pollIntervalMs: toNum(process.env.PBL_DEEPSEEK_WEB_POLL_MS, 350),
  completionStableMs: toNum(process.env.PBL_DEEPSEEK_WEB_STABLE_MS, 2200),
  requestTimeoutMs: toNum(process.env.PBL_DEEPSEEK_WEB_TIMEOUT_MS, 90000),
  failureCircuitThreshold: toNum(process.env.PBL_DEEPSEEK_WEB_CIRCUIT_FAILS, 4),
  circuitOpenMs: toNum(process.env.PBL_DEEPSEEK_WEB_CIRCUIT_OPEN_MS, 120000),
  chunkMinIntervalMs: toNum(process.env.PBL_DEEPSEEK_WEB_CHUNK_MIN_MS, 300),
  chunkMaxIntervalMs: toNum(process.env.PBL_DEEPSEEK_WEB_CHUNK_MAX_MS, 900),
  userDataDir: process.env.PBL_DEEPSEEK_WEB_USER_DATA_DIR || '',
  maxSelectorRetries: toNum(process.env.PBL_DEEPSEEK_WEB_SELECTOR_RETRIES, 2),
};

function getCooldownMs(now = new Date()) {
  const h = now instanceof Date ? now.getHours() : nowHour();
  if (h >= relayConfig.cooldownNightStartHour || h < relayConfig.cooldownDayStartHour) {
    return relayConfig.cooldownNightMs;
  }
  return relayConfig.cooldownDayMs;
}

module.exports = {
  relayConfig,
  getCooldownMs,
};
