/**
 * Web Relay Manager
 * - Provider 插件内核：队列、并发、限流、取消、熔断、日志、健康检查
 */

const { getBrowser } = require('./playwrightClient');
const { DeepSeekWebAdapter } = require('./siteAdapters/deepseekWebAdapter');
const { buildRelayPrompt } = require('./relayPromptBuilder');
const { readRelayResponse } = require('./relayResponseReader');
const browserPool = require('./browserPool');
const { normalizeRelayError } = require('./relayFallback');
const { sanitizePrompt, summarizePrompt, sanitizeResponse } = require('./relaySanitizer');
const { logEvent, logError } = require('./relayLogger');
const {
  get: getMetrics,
  recordSuccess,
  recordTimeout,
  recordSelectorFail,
  recordInterrupted,
  recordFallback,
} = require('./relayMetrics');

const ROOM_QUEUE = new Map();
const ACTIVE_REQUESTS = new Map();
const CANCELLED_REQUESTS = new Map();
const WAITERS = [];

let activeWorkers = 0;
let requestSeq = 0;
let lastRunByRoom = {};
const MAX_CONCURRENT = Number(process.env.PBL_WEB_RELAY_MAX_CONCURRENT || 2);
const ROOM_MIN_INTERVAL_MS = Number(process.env.PBL_WEB_RELAY_ROOM_MIN_INTERVAL_MS || 500);
const DEFAULT_TIMEOUT_MS = Number(process.env.PBL_WEB_RELAY_TIMEOUT_MS || 90000);

const breaker = {
  consecutiveFailures: 0,
  threshold: Number(process.env.PBL_WEB_RELAY_BREAKER_THRESHOLD || 4),
  cooldownMs: Number(process.env.PBL_WEB_RELAY_BREAKER_COOLDOWN_MS || 120000),
  openUntil: 0,
};

function now() {
  return Date.now();
}

function nextRequestId(roomCode) {
  requestSeq += 1;
  return `wr_${String(roomCode || 'default')}_${requestSeq}_${now()}`;
}

function isBreakerOpen() {
  return breaker.openUntil > now();
}

function onRelaySuccess() {
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

function onRelayFailure() {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= breaker.threshold) {
    breaker.openUntil = now() + breaker.cooldownMs;
  }
}

async function acquireWorker() {
  if (activeWorkers < MAX_CONCURRENT) {
    activeWorkers += 1;
    return;
  }
  await new Promise((resolve) => WAITERS.push(resolve));
  activeWorkers += 1;
}

function releaseWorker() {
  activeWorkers = Math.max(0, activeWorkers - 1);
  const next = WAITERS.shift();
  if (next) next();
}

async function runInRoomQueue(roomCode, fn) {
  const key = String(roomCode || 'default');
  const prev = ROOM_QUEUE.get(key) || Promise.resolve();
  let unlock = null;
  const gate = new Promise((resolve) => {
    unlock = resolve;
  });
  ROOM_QUEUE.set(key, prev.then(() => gate).catch(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    unlock();
    const latest = ROOM_QUEUE.get(key);
    if (latest === gate) ROOM_QUEUE.delete(key);
  }
}

function buildPromptFromPayload(payload) {
  const lastUser = [...(payload.messages || [])].reverse().find((m) => m.role === 'user');
  if (lastUser?.content) return sanitizePrompt(lastUser.content);
  return sanitizePrompt(buildRelayPrompt({
    role: payload.role,
    roleName: payload.roleName,
    agendaStage: payload.reasoningContext?.agenda,
    selectedTargetPoint: payload.turnPlan?.replyTarget?.point,
    keyFacts: payload.reasoningContext?.currentSnapshot?.keyFactCluster || [],
    redFlags: payload.reasoningContext?.caseUnderstanding?.redFlags || [],
    mainContradiction: payload.reasoningContext?.mainContradiction,
    openLoops: payload.reasoningContext?.openLoops || [],
    recentExcerpts: payload.recentExcerpts || [],
    speechAct: payload.speechAct,
    dialogueMove: payload.dialogueMove?.summary || payload.dialogueMove,
    outputSegmentHint: payload.role === 'teacher' ? '2~4条短消息' : '1~3条短消息',
    avoidPhrases: ['证据链尚未闭合', '先稳定循环和氧合'],
  }));
}

async function executeRelay(payload) {
  const roomCode = String(payload.roomCode || 'default');
  const requestId = payload.requestId || nextRequestId(roomCode);
  const startedAt = now();
  const timeoutMs = Number(payload.timeoutMs || DEFAULT_TIMEOUT_MS);
  const adapter = new DeepSeekWebAdapter({ timeout: timeoutMs });
  let timeoutTriggered = false;

  if (isBreakerOpen()) {
    const reason = 'breaker_open';
    recordFallback(roomCode);
    return {
      requestId,
      relayAttempted: false,
      relaySucceeded: false,
      relayAbortReason: reason,
      relayLatencyMs: 0,
      relayAdapterName: adapter.name,
      providerName: 'web_relay_deepseek',
      sourceMode: 'web_relay',
    };
  }

  const ac = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutTriggered = true;
    ac.abort('timeout');
  }, timeoutMs);
  if (payload.abortSignal) {
    if (payload.abortSignal.aborted) {
      ac.abort('upstream_aborted');
    } else {
      payload.abortSignal.addEventListener('abort', () => ac.abort('upstream_aborted'), { once: true });
    }
  }
  ACTIVE_REQUESTS.set(requestId, {
    roomCode,
    startedAt,
    controller: ac,
    status: 'running',
  });

  const cancelled = CANCELLED_REQUESTS.get(requestId);
  if (cancelled) {
    ac.abort(cancelled.reason || 'cancelled_before_start');
    CANCELLED_REQUESTS.delete(requestId);
  }

  try {
    await acquireWorker();
    const lastRun = Number(lastRunByRoom[roomCode] || 0);
    const delta = now() - lastRun;
    if (delta < ROOM_MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, ROOM_MIN_INTERVAL_MS - delta));
    }

    const { session, reused } = await browserPool.getOrCreate(roomCode);
    const page = session.page;

    await adapter.ensureReady(page);
    const prompt = buildPromptFromPayload(payload);
    await adapter.sendPrompt(page, prompt);

    const text = await readRelayResponse({
      adapter,
      page,
      maxWaitMs: Math.max(1000, timeoutMs - (now() - startedAt)),
      abortSignal: ac.signal,
    });

    const responseText = sanitizeResponse(text);
    const latency = now() - startedAt;
    lastRunByRoom[roomCode] = now();
    onRelaySuccess();
    recordSuccess(latency, roomCode);

    const event = {
      ts: now(),
      roomCode,
      requestId,
      role: payload.role,
      sourceMode: 'web_relay',
      providerPolicy: payload.providerPolicy || '',
      adapter: adapter.name,
      promptSummary: summarizePrompt(prompt),
      responseLength: responseText.length,
      chunkCount: Number(payload.chunkCountHint || 0),
      latencyMs: latency,
      success: true,
      failReason: '',
      interruptedByUser: false,
      relayPageReused: reused,
    };
    logEvent(event);

    return {
      requestId,
      relayAttempted: true,
      relaySucceeded: true,
      relayLatencyMs: latency,
      relayAdapterName: adapter.name,
      relayPageReused: reused,
      relayReadMode: 'final_only',
      relayAbortReason: '',
      content: responseText,
      providerName: 'web_relay_deepseek',
      sourceMode: 'web_relay',
      providerPolicy: payload.providerPolicy || '',
    };
  } catch (e) {
    const latency = now() - startedAt;
    let normalized = normalizeRelayError(e);
    if (timeoutTriggered && normalized === 'aborted') normalized = 'timeout';
    onRelayFailure();

    if (normalized === 'timeout') recordTimeout(roomCode);
    else if (normalized === 'aborted') recordInterrupted(roomCode);
    else recordSelectorFail(normalized, roomCode);

    const failPayload = {
      ts: now(),
      roomCode,
      requestId,
      role: payload.role,
      sourceMode: 'web_relay',
      providerPolicy: payload.providerPolicy || '',
      adapter: adapter.name,
      promptSummary: summarizePrompt(buildPromptFromPayload(payload)),
      responseLength: 0,
      chunkCount: 0,
      latencyMs: latency,
      success: false,
      failReason: normalized,
      interruptedByUser: normalized === 'aborted',
    };
    logEvent(failPayload);
    logError({ ...failPayload, rawError: String(e?.message || e) });

    if (normalized !== 'aborted') {
      await browserPool.reset(roomCode);
    }

    return {
      requestId,
      relayAttempted: true,
      relaySucceeded: false,
      relayLatencyMs: latency,
      relayAdapterName: adapter.name,
      relayAbortReason: normalized,
      content: '',
      providerName: 'web_relay_deepseek',
      sourceMode: 'web_relay',
      providerPolicy: payload.providerPolicy || '',
    };
  } finally {
    clearTimeout(timeoutTimer);
    ACTIVE_REQUESTS.delete(requestId);
    releaseWorker();
  }
}

async function request(payload) {
  const roomCode = String(payload.roomCode || 'default');
  return runInRoomQueue(roomCode, () => executeRelay(payload));
}

function cancelRequest(requestId, reason = 'user_interrupted') {
  const id = String(requestId || '');
  if (!id) return { ok: false, reason: 'empty_request_id' };

  const active = ACTIVE_REQUESTS.get(id);
  if (active?.controller) {
    active.controller.abort(reason);
    return { ok: true, cancelled: 'running' };
  }
  CANCELLED_REQUESTS.set(id, { ts: now(), reason });
  return { ok: true, cancelled: 'queued' };
}

async function health() {
  let browserReady = false;
  try {
    browserReady = !!(await getBrowser());
  } catch (_) {
    browserReady = false;
  }
  const m = getMetrics();
  return {
    status: browserReady ? 'ok' : 'browser_not_ready',
    browserReady,
    providerStatus: isBreakerOpen() ? 'circuit_open' : 'healthy',
    breaker: {
      open: isBreakerOpen(),
      openUntil: breaker.openUntil,
      consecutiveFailures: breaker.consecutiveFailures,
      threshold: breaker.threshold,
      cooldownMs: breaker.cooldownMs,
    },
    worker: {
      activeWorkers,
      maxConcurrent: MAX_CONCURRENT,
      queueLength: WAITERS.length,
    },
    browserPool: browserPool.stats(),
    metrics: m,
    lastErrors: m.lastErrors,
  };
}

async function openSession(roomCode, site = 'deepseek_web') {
  if (!roomCode) return { ok: false, message: 'roomCode required' };
  if (site !== 'deepseek_web') return { ok: false, message: 'unsupported site' };
  const { session, reused } = await browserPool.getOrCreate(roomCode);
  const adapter = new DeepSeekWebAdapter({ timeout: DEFAULT_TIMEOUT_MS });
  await adapter.ensureReady(session.page);
  return { ok: true, roomCode, reused, adapter: adapter.name };
}

async function testSend(roomCode, role = 'A教授', text) {
  const prompt = text || buildRelayPrompt({
    role: 'teacher',
    roleName: 'A教授',
    agendaStage: '处置优先级',
    mainContradiction: '路径分叉尚未闭环',
    keyFacts: ['BP 90/60', '乳酸 4.2'],
    outputSegmentHint: '2~4条短消息',
  });

  const result = await request({
    roomCode: roomCode || 'default',
    role: 'teacher',
    roleName: role,
    messages: [{ role: 'user', content: prompt }],
    reasoningContext: { agenda: '处置优先级', mainContradiction: '路径分叉尚未闭环' },
    turnPlan: { replyTarget: { point: 'test_send' } },
    recentExcerpts: [],
    providerPolicy: 'web_relay_only',
  });

  return {
    ok: !!result.relaySucceeded,
    contentPreview: String(result.content || '').slice(0, 300),
    relaySucceeded: !!result.relaySucceeded,
    relayLatencyMs: Number(result.relayLatencyMs || 0),
    relayAttempted: !!result.relayAttempted,
    relayAbortReason: result.relayAbortReason || '',
    requestId: result.requestId,
    debugMeta: {
      sourceMode: 'web_relay',
      providerName: result.providerName,
      relayAttempted: !!result.relayAttempted,
      relaySucceeded: !!result.relaySucceeded,
      relayLatencyMs: Number(result.relayLatencyMs || 0),
      relayAdapterName: result.relayAdapterName || '',
      relayReadMode: result.relayReadMode || 'final_only',
    },
  };
}

async function resetSession(roomCode) {
  await browserPool.reset(roomCode);
  return { ok: true, roomCode: String(roomCode || '') };
}

function metrics() {
  return getMetrics();
}

module.exports = {
  request,
  cancelRequest,
  markFallback: (roomCode) => recordFallback(roomCode),
  health,
  openSession,
  testSend,
  resetSession,
  metrics,
};
