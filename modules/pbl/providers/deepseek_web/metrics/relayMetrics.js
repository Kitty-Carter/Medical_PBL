const roomStats = new Map();

const metrics = {
  total: 0,
  success: 0,
  timeout: 0,
  failed: 0,
  aborted: 0,
  selectorFallback: 0,
  queueDropped: 0,
  latencies: [],
  recentErrors: [],
};

function ensureRoom(roomCode) {
  const key = String(roomCode || 'unknown');
  if (!roomStats.has(key)) {
    roomStats.set(key, {
      total: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      aborted: 0,
      avgLatencyMs: 0,
      lastLatencyMs: 0,
    });
  }
  return roomStats.get(key);
}

function pushLatency(ms) {
  metrics.latencies.push(ms);
  if (metrics.latencies.length > 300) metrics.latencies.shift();
}

function avgLatency() {
  if (!metrics.latencies.length) return 0;
  return Math.round(metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length);
}

function mark(kind, roomCode, payload = {}) {
  metrics.total += 1;
  const room = ensureRoom(roomCode);
  room.total += 1;

  if (kind === 'success') {
    metrics.success += 1;
    room.success += 1;
    if (Number.isFinite(payload.latencyMs)) {
      pushLatency(payload.latencyMs);
      room.lastLatencyMs = payload.latencyMs;
    }
  }
  if (kind === 'timeout') {
    metrics.timeout += 1;
    room.timeout += 1;
  }
  if (kind === 'failed') {
    metrics.failed += 1;
    room.failed += 1;
  }
  if (kind === 'aborted') {
    metrics.aborted += 1;
    room.aborted += 1;
  }
  if (kind === 'selectorFallback') {
    metrics.selectorFallback += 1;
    metrics.total -= 1;
    room.total -= 1;
  }
  if (kind === 'queueDropped') {
    metrics.queueDropped += 1;
    metrics.total -= 1;
    room.total -= 1;
  }

  room.avgLatencyMs = room.success ? Math.round(((room.avgLatencyMs * (room.success - 1)) + (room.lastLatencyMs || 0)) / room.success) : 0;

  if (payload.error) {
    metrics.recentErrors.push({ ts: Date.now(), roomCode, error: payload.error });
    if (metrics.recentErrors.length > 20) metrics.recentErrors.shift();
  }
}

function getMetrics() {
  return {
    successRate: metrics.total ? Number((metrics.success / metrics.total).toFixed(4)) : 0,
    timeoutRate: metrics.total ? Number((metrics.timeout / metrics.total).toFixed(4)) : 0,
    avgLatencyMs: avgLatency(),
    selectorFallbackRate: metrics.total ? Number((metrics.selectorFallback / metrics.total).toFixed(4)) : 0,
    totals: { ...metrics },
    perRoom: Array.from(roomStats.entries()).map(([roomCode, stat]) => ({ roomCode, ...stat })),
  };
}

module.exports = {
  mark,
  getMetrics,
};
