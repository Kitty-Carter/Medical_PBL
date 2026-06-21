const fs = require('fs');
const path = require('path');
const { relayConfig, getCooldownMs } = require('./config/config');
const { RelayQueue } = require('./queue/relayQueue');
const { WebRelayEvaluator } = require('./queue/relayEvaluator');
const { createRelayJob, transitionJob } = require('./queue/relayJob');
const { getOrCreateRoomSession, resetRoomSession, shutdownBrowserPool } = require('./browser/browserPool');
const { DeepSeekWebAdapter, ProviderError } = require('./adapter/DeepSeekWebAdapter');
const { buildRelayPrompt } = require('./prompt/relayPromptBuilder');
const { sanitizeRelayText } = require('./output/relaySanitizer');
const { relayChunker } = require('./output/relayChunker');
const { mark, getMetrics } = require('./metrics/relayMetrics');
const { buildRelayDebugMeta } = require('./debug/relayDebugMeta');

const EVENTS_DIR = path.join(process.cwd(), 'records', 'web_relay');

function ensureEventsDir() {
  if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
}

function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function appendJsonl(fileName, data) {
  ensureEventsDir();
  const line = `${JSON.stringify(data)}\n`;
  fs.appendFileSync(path.join(EVENTS_DIR, fileName), line, 'utf8');
}

function logEvent(data) {
  appendJsonl(`relay-events-${dateKey()}.jsonl`, data);
}

function logError(data) {
  appendJsonl(`relay-errors-${dateKey()}.jsonl`, data);
}

class DeepSeekWebProvider {
  constructor() {
    this.name = 'deepseek_web';
    this.queue = new RelayQueue({
      maxSize: relayConfig.queueMaxSize,
      globalConcurrency: relayConfig.globalConcurrency,
    });
    this.evaluator = new WebRelayEvaluator();
    this.runningByRoom = new Map();
    this.cooldownUntil = new Map();
    this.failureStreak = 0;
    this.circuitOpenUntil = 0;
    this.pendingDebounce = new Map();
    this.closed = false;

    this.queue.on('dropped', (evt) => {
      mark('queueDropped', evt.roomCode, { error: evt.reason });
      logEvent({ ts: Date.now(), sourceMode: 'deepseek_web', state: 'dropped', ...evt });
    });
  }

  isCircuitOpen() {
    return Date.now() < this.circuitOpenUntil;
  }

  openCircuit(reason) {
    this.circuitOpenUntil = Date.now() + relayConfig.circuitOpenMs;
    this.failureStreak = 0;
    logError({ ts: Date.now(), sourceMode: 'deepseek_web', state: 'circuit_open', reason, openUntil: this.circuitOpenUntil });
  }

  evaluateDispatch(ctx) {
    return this.evaluator.evaluate(ctx);
  }

  async call({ prompt, roomCode, roleKey, meta = {}, abortSignal }) {
    if (!relayConfig.enabled) {
      throw new ProviderError('PROVIDER_DISABLED', 'deepseek_web disabled');
    }
    if (this.isCircuitOpen()) {
      throw new ProviderError('CIRCUIT_OPEN', 'deepseek_web circuit breaker open', { openUntil: this.circuitOpenUntil });
    }

    const cooldownMs = getCooldownMs();
    const now = Date.now();
    const cooldownUntil = Number(this.cooldownUntil.get(roomCode) || 0);
    const bypass = meta.priority >= 90 && relayConfig.allowHighPriorityBypassCooldown;
    if (cooldownUntil > now && !bypass) {
      throw new ProviderError('ROOM_COOLDOWN', 'room in cooldown', { roomCode, cooldownLeftMs: cooldownUntil - now });
    }

    const finalPrompt = prompt || buildRelayPrompt(meta);
    const job = createRelayJob({
      roomCode,
      roleKey,
      prompt: finalPrompt,
      meta,
      ttlMs: relayConfig.jobTtlMs,
      abortController: new AbortController(),
    });

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        try { job.abortController.abort(); } catch (_) {}
      });
    }

    const waitResult = new Promise((resolve, reject) => {
      job._resolve = resolve;
      job._reject = reject;
    });

    this.enqueueWithDebounce(job);
    this.drainQueue();
    return waitResult;
  }

  enqueueWithDebounce(job) {
    const roomCode = job.roomCode;
    const prev = this.pendingDebounce.get(roomCode);
    if (prev) {
      clearTimeout(prev.timer);
      prev.jobs.forEach((j) => {
        j.stale = true;
        j.staleReason = 'merged_by_newer_snapshot';
        transitionJob(j, 'dropped', { stale: true });
        j._reject?.(new ProviderError('JOB_STALE', 'job replaced by newer message', { roomCode }));
      });
    }

    const holder = {
      jobs: [job],
      timer: setTimeout(() => {
        this.pendingDebounce.delete(roomCode);
        const merged = holder.jobs[holder.jobs.length - 1];
        const ok = this.queue.enqueue(merged);
        if (!ok.ok) {
          merged._reject?.(new ProviderError('QUEUE_FULL', 'relay queue full'));
          return;
        }
        this.drainQueue();
      }, relayConfig.roomDebounceMs),
    };

    this.pendingDebounce.set(roomCode, holder);
  }

  async drainQueue() {
    if (this.closed) return;
    let next = this.queue.nextRunnable();
    while (next) {
      this.runJob(next).finally(() => this.drainQueue());
      next = this.queue.nextRunnable();
    }
  }

  async runJob(job) {
    transitionJob(job, 'running');
    this.runningByRoom.set(job.roomCode, job);

    const started = Date.now();
    const adapter = new DeepSeekWebAdapter();
    let session = null;
    let text = '';

    logEvent({
      ts: Date.now(),
      sourceMode: 'deepseek_web',
      roomCode: job.roomCode,
      roleKey: job.roleKey,
      jobId: job.id,
      state: 'running',
      ttlMs: job.ttlMs,
      triggerReason: job.triggerReason,
    });

    try {
      if (job.abortSignal.aborted) throw new ProviderError('ABORTED', 'aborted before run');

      session = await getOrCreateRoomSession(job.roomCode);
      await adapter.ensureReady(session.page);
      await adapter.sendPrompt(session.page, job.prompt);
      await adapter.waitForStreamingStart(session.page);
      await adapter.waitForCompletion(session.page);
      text = await adapter.getFinalResponse(session.page);

      const clean = sanitizeRelayText(text);
      const chunks = relayChunker({ roleKey: job.roleKey, text: clean });
      const latencyMs = Date.now() - started;
      transitionJob(job, 'succeeded', { latencyMs });
      this.cooldownUntil.set(job.roomCode, Date.now() + getCooldownMs());
      this.failureStreak = 0;

      mark('success', job.roomCode, { latencyMs });
      logEvent({
        ts: Date.now(),
        sourceMode: 'deepseek_web',
        roomCode: job.roomCode,
        roleKey: job.roleKey,
        jobId: job.id,
        state: 'succeeded',
        relayLatencyMs: latencyMs,
        selectorFallbackUsed: !!adapter.selectorFallbackUsed,
        chunkCount: chunks.chunkCount,
        chunkTypes: chunks.chunkTypes,
      });

      const providerMeta = buildRelayDebugMeta({
        providerPolicy: job.meta.providerPolicy,
        relayAttempted: true,
        relaySucceeded: true,
        relayLatencyMs: latencyMs,
        relayAdapterName: adapter.name,
        relaySelectorFallbackUsed: !!adapter.selectorFallbackUsed,
        queueWaitMs: job.queueWaitMs,
        cooldownMsApplied: getCooldownMs(),
        jobState: 'succeeded',
        chunkCount: chunks.chunkCount,
        chunkTypes: chunks.chunkTypes,
        triggerReason: job.meta.triggerReason,
        triggerRuleMatched: job.meta.triggerRuleMatched,
        speechAct: job.meta.speechAct,
        mainContradiction: job.meta.mainContradiction,
        keyFactCluster: job.meta.keyFactCluster,
      });

      job._resolve?.({
        text: clean,
        raw: text,
        chunks,
        providerMeta,
        relayMeta: {
          relayAttempted: true,
          relaySucceeded: true,
          relayLatencyMs: latencyMs,
          relayAdapterName: adapter.name,
          relaySelectorFallbackUsed: !!adapter.selectorFallbackUsed,
          queueWaitMs: job.queueWaitMs,
          jobState: 'succeeded',
        },
      });
    } catch (error) {
      const latencyMs = Date.now() - started;
      const aborted = job.abortSignal.aborted || error.code === 'ABORTED' || /aborted/i.test(error.message || '');
      const timeout = error.code === 'WAIT_COMPLETION_TIMEOUT' || /timeout/i.test(error.message || '');
      transitionJob(job, aborted ? 'aborted' : 'failed', { latencyMs, failReason: error.message });

      if (timeout) mark('timeout', job.roomCode, { error: error.message });
      else if (aborted) mark('aborted', job.roomCode, { error: error.message });
      else mark('failed', job.roomCode, { error: error.message });

      if (!aborted) {
        this.failureStreak += 1;
        if (this.failureStreak >= relayConfig.failureCircuitThreshold) {
          this.openCircuit(error.message);
        }
      }

      logError({
        ts: Date.now(),
        sourceMode: 'deepseek_web',
        roomCode: job.roomCode,
        roleKey: job.roleKey,
        jobId: job.id,
        state: aborted ? 'aborted' : 'failed',
        relayLatencyMs: latencyMs,
        failReason: error.message,
      });

      job._reject?.(error);
    } finally {
      this.runningByRoom.delete(job.roomCode);
      this.queue.complete(job, job.state);
    }
  }

  cancelRoom(roomCode, reason = 'user_interrupt') {
    const running = this.runningByRoom.get(String(roomCode || 'unknown'));
    if (running) {
      try {
        running.abortController.abort(reason);
      } catch (_) {}
    }
    this.queue.removeRoomJobs(roomCode, reason);
  }

  async health() {
    const queueSnapshot = this.queue.snapshot();
    return {
      provider: this.name,
      enabled: relayConfig.enabled,
      circuitOpen: this.isCircuitOpen(),
      circuitOpenUntil: this.circuitOpenUntil,
      runningJobs: Array.from(this.runningByRoom.values()).map((j) => ({ roomCode: j.roomCode, jobId: j.id, state: j.state })),
      queue: queueSnapshot,
      metrics: getMetrics(),
    };
  }

  async openSession({ roomCode }) {
    const session = await getOrCreateRoomSession(roomCode);
    return {
      ok: true,
      roomCode,
      sessionId: session.sessionId,
      reused: !!session.reused,
    };
  }

  async resetSession({ roomCode }) {
    this.cancelRoom(roomCode, 'session_reset');
    const closed = await resetRoomSession(roomCode);
    return { ok: true, roomCode, closed };
  }

  async testSend({ roomCode, roleKey = 'ai_teacher', text, meta = {} }) {
    const prompt = text || buildRelayPrompt({ roleKey, ...meta });
    const res = await this.call({
      prompt,
      roomCode,
      roleKey,
      meta: {
        ...meta,
        triggerReason: meta.triggerReason || 'api_test_send',
      },
    });
    return {
      ok: true,
      roomCode,
      roleKey,
      replyPreview: String(res.text || '').slice(0, 260),
      latencyMs: res.relayMeta?.relayLatencyMs || 0,
      debugMeta: res.providerMeta,
      chunkCount: res.chunks?.chunkCount || 0,
      chunkTypes: res.chunks?.chunkTypes || [],
    };
  }

  async shutdown() {
    this.closed = true;
    for (const [roomCode] of this.pendingDebounce.entries()) {
      this.cancelRoom(roomCode, 'provider_shutdown');
    }
    await shutdownBrowserPool();
  }
}

const singleton = new DeepSeekWebProvider();

module.exports = {
  DeepSeekWebProvider,
  deepSeekWebProvider: singleton,
};
