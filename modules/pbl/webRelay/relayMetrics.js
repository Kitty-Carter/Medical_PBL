/**
 * Web Relay 指标
 */

const metrics = {
  totalAttempts: 0,
  successCount: 0,
  timeoutCount: 0,
  selectorFailCount: 0,
  interruptedCount: 0,
  fallbackCount: 0,
  latencies: [],
  lastErrors: [],
  maxLastErrors: 5,
  perRoom: {},
};

function roomCounter(roomCode) {
  const key = String(roomCode || 'unknown');
  if (!metrics.perRoom[key]) {
    metrics.perRoom[key] = { attempts: 0, success: 0, timeout: 0, interrupted: 0, selectorFail: 0 };
  }
  return metrics.perRoom[key];
}

function recordSuccess(latencyMs, roomCode) {
  metrics.totalAttempts += 1;
  metrics.successCount += 1;
  metrics.latencies.push(latencyMs);
  if (metrics.latencies.length > 100) metrics.latencies.shift();
  const rc = roomCounter(roomCode);
  rc.attempts += 1;
  rc.success += 1;
}

function recordTimeout(roomCode) {
  metrics.totalAttempts += 1;
  metrics.timeoutCount += 1;
  metrics.lastErrors.push({ ts: Date.now(), reason: 'timeout' });
  if (metrics.lastErrors.length > metrics.maxLastErrors) metrics.lastErrors.shift();
  const rc = roomCounter(roomCode);
  rc.attempts += 1;
  rc.timeout += 1;
}

function recordSelectorFail(reason, roomCode) {
  metrics.totalAttempts += 1;
  metrics.selectorFailCount += 1;
  metrics.lastErrors.push({ ts: Date.now(), reason: reason || 'selector_fail' });
  if (metrics.lastErrors.length > metrics.maxLastErrors) metrics.lastErrors.shift();
  const rc = roomCounter(roomCode);
  rc.attempts += 1;
  rc.selectorFail += 1;
}

function recordInterrupted(roomCode) {
  metrics.totalAttempts += 1;
  metrics.interruptedCount += 1;
  const rc = roomCounter(roomCode);
  rc.attempts += 1;
  rc.interrupted += 1;
}

function recordFallback(roomCode) {
  metrics.fallbackCount += 1;
  roomCounter(roomCode);
}

function get() {
  const lat = metrics.latencies;
  const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
  return {
    totalAttempts: metrics.totalAttempts,
    successCount: metrics.successCount,
    timeoutCount: metrics.timeoutCount,
    selectorFailCount: metrics.selectorFailCount,
    interruptedCount: metrics.interruptedCount,
    fallbackCount: metrics.fallbackCount,
    successRate: metrics.totalAttempts ? metrics.successCount / metrics.totalAttempts : 0,
    timeoutRate: metrics.totalAttempts ? metrics.timeoutCount / metrics.totalAttempts : 0,
    selectorFallbackRate: metrics.totalAttempts ? metrics.selectorFailCount / metrics.totalAttempts : 0,
    avgLatencyMs: Math.round(avg),
    lastErrors: [...metrics.lastErrors],
    perRoom: { ...metrics.perRoom },
  };
}

module.exports = {
  recordSuccess,
  recordTimeout,
  recordSelectorFail,
  recordInterrupted,
  recordFallback,
  get,
};
