const { randomUUID } = require('crypto');

function createRelayJob(input = {}) {
  const now = Date.now();
  const ttlMs = Number(input.ttlMs || 180000);
  const controller = input.abortController || new AbortController();
  return {
    id: input.id || randomUUID(),
    roomCode: String(input.roomCode || 'unknown'),
    roleKey: String(input.roleKey || 'ai_teacher'),
    triggerReason: String(input.triggerReason || 'unknown'),
    prompt: String(input.prompt || ''),
    meta: input.meta || {},
    state: 'queued',
    queuedAt: now,
    startedAt: 0,
    endedAt: 0,
    ttlMs,
    expireAt: now + ttlMs,
    abortController: controller,
    abortSignal: controller.signal,
    stale: false,
    staleReason: '',
    queueWaitMs: 0,
    latencyMs: 0,
  };
}

function transitionJob(job, nextState, extra = {}) {
  const now = Date.now();
  if (nextState === 'running') {
    job.startedAt = now;
    job.queueWaitMs = Math.max(0, now - job.queuedAt);
  }
  if (['failed', 'succeeded', 'aborted', 'dropped'].includes(nextState)) {
    job.endedAt = now;
    job.latencyMs = job.startedAt ? (now - job.startedAt) : 0;
  }
  job.state = nextState;
  Object.assign(job, extra);
  return job;
}

function isExpired(job, now = Date.now()) {
  return now >= Number(job.expireAt || 0);
}

module.exports = {
  createRelayJob,
  transitionJob,
  isExpired,
};
