// 指标收集
const metrics = {
  totalTurns: 0,
  successfulTurns: 0,
  failedTurns: 0,
  rewriteCount: 0,
  retryCount: 0,
  interruptedCount: 0,
  totalDurationMs: 0,
};

function recordTurn(success, duration) {
  metrics.totalTurns++;
  if (success) {
    metrics.successfulTurns++;
  } else {
    metrics.failedTurns++;
  }
  metrics.totalDurationMs += duration;
}

function recordRewrite() {
  metrics.rewriteCount++;
}

function recordRetry() {
  metrics.retryCount++;
}

function recordInterruption() {
  metrics.interruptedCount++;
}

function getMetrics() {
  return { ...metrics };
}

module.exports = {
  recordTurn,
  recordRewrite,
  recordRetry,
  recordInterruption,
  getMetrics,
};
