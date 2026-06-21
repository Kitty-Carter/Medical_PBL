const { LongcatClient } = require('./longcatClient');
const { pblConfig } = require('./config');
const { resolveSpeechAct } = require('./speechActs');
const { resolveDialogueMove } = require('./dialogueMoves');
const { resolveProvider } = require('./providerRouter');
const webRelayManager = require('./webRelay/webRelayManager');
const webRelayProvider = require('./webRelay/webRelayProvider');
const { updateDiscussionState } = require('./stateManager');
const { fallbackTurnTask } = require('./turnTaskBuilder');
const { retrieveEvidence } = require('./evidence/retriever');
const { generateRoleDraft } = require('./roleGenerator');
const { evaluateTurn } = require('./evaluator');
const { renderStyle, structuredRender } = require('./styleRenderer');
const { ROLE_MAP } = require('./types');
const { validateOutput } = require('./outputGuard');
const { buildRoleFallback } = require('./fallbacks');
const { parseCaseUnderstanding } = require('./caseParser');
const { buildReasoningContext } = require('./clinicalReasoner');
const { makeTurnPlan } = require('./discoursePlanner');
const { scoreMessageInformation } = require('./triggerEngine');
const { recordMetrics, getMetrics } = require('./metrics');
const { buildTeacherSkeleton, buildYuSkeleton, buildPengSkeleton } = require('./contentSkeletonBuilder');
const { planChunks } = require('./messageChunkPlanner');
const { defaultRoleMemory, updateRoleMemory } = require('./roleStateManager');
const PIPELINE_VERSION = 'pbl-pipeline-v2.1';

const stateBySession = new Map();
const client = new LongcatClient(pblConfig);
const roleMemoryBySession = new Map();

function getSessionId(room) {
  return room.roomCode || room.sessionId || 'unknown';
}

function toPublicRole(roleType) {
  if (roleType === 'teacher') return 'ai_teacher';
  if (roleType === 'student_critic') return 'ai_student_B';
  return 'ai_student_C';
}

function toDisplayName(roleType) {
  if (roleType === 'teacher') return 'A教授';
  if (roleType === 'student_critic') return 'B同学';
  return 'C同学';
}

function recentExcerpts(room) {
  return (room.messages || [])
    .filter((m) => m.type === 'text')
    .slice(-3)
    .map((m) => `${m.sender?.name || '未知'}: ${String(m.content || '').slice(0, 180)}`);
}

async function nextTurn(room, options = {}) {
  const sessionId = getSessionId(room);
  const prev = stateBySession.get(sessionId);
  let state = updateDiscussionState(prev, room, { sessionId });
  const evidencePack = await retrieveEvidence(state, { topK: pblConfig.evidenceTopK });
  const turnTask = fallbackTurnTask({ state, room, preferredRole: options.preferredRole });
  const caseUnderstanding = parseCaseUnderstanding(state, room);
  const reasoningContext = buildReasoningContext({ state, room, caseUnderstanding, evidencePack });
  const roleMem = roleMemoryBySession.get(sessionId) || defaultRoleMemory();
  const recentAiRoles = (state.speakerHistory || []).filter((x) => /^ai_/.test(x)).slice(-4);
  const activitySignal = {
    recentAiRoles,
    aiTurnsInRecentWindow: recentAiRoles.length,
    repetitiveRoleRisk: recentAiRoles.length >= 2 && recentAiRoles[recentAiRoles.length - 1] === recentAiRoles[recentAiRoles.length - 2],
  };
  let turnPlan = makeTurnPlan({ turnTask, state, reasoningContext, recentMessages: room.messages || [], roleMemory: roleMem, activitySignal });
  if (turnPlan.replyTarget?.point && turnPlan.replyTarget.point !== 'case_opening_agenda') {
    turnPlan.replyTargetScore = scoreMessageInformation(turnPlan.replyTarget.point);
  }

  const dbg = { turnPlan: {}, roleDraft: {}, renderer: {}, outputGuard: {}, fallbackUsed: false, fallbackReason: '' };
  const apiMeta = {
    apiCallAttempted: false,
    apiCallSucceeded: false,
    preferredModel: '',
    actualModel: '',
    modelFallback: false,
    modelFallbackReason: '',
    responseId: '',
    usage: {},
    requestedModel: '',
    providerResolvedModel: '',
    modelRoutingStage: '',
  };
  dbg.turnPlan = {
    meetingIntent: turnPlan.meetingIntent,
    agenda: turnPlan.agenda,
    replyTarget: turnPlan.replyTarget,
    anchors: turnPlan.clinicalAnchors,
  };
  const roleKey = turnTask.roleType === 'teacher' ? 'ai_teacher' : (turnTask.roleType === 'student_critic' ? 'ai_student_B' : 'ai_student_C');
  const skeletonCtx = {
    roleKey,
    roleName: turnTask.roleName,
    turnPlan,
    reasoningContext,
    state,
  };
  const speechAct = resolveSpeechAct(roleKey, {
    turnPlan,
    reasoningContext,
    roleMemory: roleMem,
    triggerReason: options.triggerReason || '',
  });
  const dialogueMove = resolveDialogueMove(roleKey, speechAct, { turnPlan, reasoningContext });
  const providerRoute = resolveProvider({
    role: turnTask.roleType,
    stage: 'role_draft',
    triggerReason: options.triggerReason,
    roomCode: sessionId,
    providerHealth: {
      webRelayHealthy: !options.webRelayCircuitOpen,
    },
    interruptionSignal: {
      recentInterruptions: Number(room?.pendingChunksDiscarded || 0) > 0 ? 1 : 0,
    },
  });
  const contentSkeleton = turnTask.roleType === 'teacher'
    ? buildTeacherSkeleton(skeletonCtx)
    : turnTask.roleType === 'student_critic'
      ? buildYuSkeleton(skeletonCtx, roleMem.B)
      : buildPengSkeleton(skeletonCtx, roleMem.C);
  dbg.skeleton = {
    roleKey: contentSkeleton.roleKey,
    meetingActionType: contentSkeleton.meetingActionType || '',
    stanceAction: contentSkeleton.stanceAction || '',
    keyFactCluster: contentSkeleton.currentSnapshotRef?.keyFactCluster || [],
    contradictionAnchor: contentSkeleton.contradictionAnchor || {},
    usedTargetPointAsPrimary: !!contentSkeleton.usedTargetPointAsPrimary,
  };
  let sourceMode = 'longcat';
  let relayMeta = {
    relayAttempted: false,
    relaySucceeded: false,
    relayLatencyMs: 0,
    relayAdapterName: '',
    relayAbortReason: '',
    relayPageReused: false,
    relayReadMode: 'final_only',
    providerName: '',
    relayRequestId: '',
  };
  let draftResult;
  let renderResult;

  if (providerRoute.primary === 'web_relay' && pblConfig.webRelayEnabled) {
    try {
      const relayRes = await webRelayProvider.invoke({
        requestId: options.webRelayRequestId,
        messages: [],
        role: turnTask.roleType,
        roleName: turnTask.roleName,
        roomCode: sessionId,
        reasoningContext,
        turnPlan: { ...turnPlan, roomCode: sessionId, speechAct, dialogueMove },
        recentExcerpts: recentExcerpts(room),
        speechAct,
        dialogueMove,
        providerPolicy: pblConfig.providerPolicy,
        abortSignal: options.abortSignal,
      });
      relayMeta = {
        relayAttempted: !!relayRes.relayAttempted,
        relaySucceeded: !!relayRes.relaySucceeded,
        relayLatencyMs: Number(relayRes.relayLatencyMs || 0),
        relayAdapterName: relayRes.relayAdapterName || '',
        relayAbortReason: relayRes.relayAbortReason || '',
          relayPageReused: !!relayRes.relayPageReused,
          relayReadMode: relayRes.relayReadMode || 'final_only',
          providerName: relayRes.providerName || 'web_relay_deepseek',
          relayRequestId: relayRes.requestId || '',
      };
      if (relayRes.relaySucceeded && relayRes.content) {
        sourceMode = 'web_relay';
        draftResult = {
          draft: {
            replyTo: turnPlan.replyTarget,
            stance: reasoningContext.mainContradiction || '推进主矛盾',
            reasoningBullets: (reasoningContext.currentSnapshot?.keyFactCluster || []).slice(0, 3),
            questions: [turnPlan.branchQuestion],
            proposedNextStep: turnPlan.nextAction,
            safetyNote: 'web_relay',
          },
          meta: { usedFallback: false, parseOk: true, finalDraftSource: 'web_relay', apiMeta: {} },
        };
        renderResult = { message: relayRes.content, meta: { usedFallback: false, apiMeta: {} } };
      }
    } catch (_) {}
  }

  if (sourceMode === 'longcat') {
    if (providerRoute.primary === 'web_relay' && relayMeta.relayAttempted && !relayMeta.relaySucceeded) {
      webRelayManager.markFallback(sessionId);
    }
    draftResult = await generateRoleDraft({
      client,
      turnTask,
      turnPlan,
      contentSkeleton,
      reasoningContext,
      state,
      evidencePack,
      recentExcerpts: recentExcerpts(room),
      recentMessages: room.messages || [],
    });
    renderResult = await renderStyle({ client, turnTask, turnPlan, draft: draftResult.draft, evidencePack, state, recentMessages: room.messages || [], sessionId, contentSkeleton });
  }

  let draft = draftResult.draft;
  if (draftResult.meta?.apiMeta) Object.assign(apiMeta, { ...apiMeta, ...draftResult.meta.apiMeta });
  dbg.roleDraft = {
    parseOk: !!draftResult.meta?.parseOk,
    usedFallback: !!draftResult.meta?.usedFallback,
    fallbackReason: draftResult.meta?.fallbackReason || '',
    rawPreview: String(draftResult.meta?.raw || '').slice(0, 220),
    parseAttemptCount: Number(draftResult.meta?.parseAttemptCount || 0),
    parseModeTried: draftResult.meta?.parseModeTried || [],
    finalDraftSource: draftResult.meta?.finalDraftSource || '',
  };

  let message = renderResult.message;
  if (renderResult.meta?.apiMeta) {
    apiMeta.apiCallAttempted = apiMeta.apiCallAttempted || !!renderResult.meta.apiMeta.apiCallAttempted;
    apiMeta.apiCallSucceeded = apiMeta.apiCallSucceeded || !!renderResult.meta.apiMeta.apiCallSucceeded;
    // keep generation-stage model as primary; rendering stage should not overwrite it
    apiMeta.preferredModel = apiMeta.preferredModel || renderResult.meta.apiMeta.preferredModel || '';
    apiMeta.actualModel = apiMeta.actualModel || renderResult.meta.apiMeta.actualModel || '';
    apiMeta.modelFallback = apiMeta.modelFallback || !!renderResult.meta.apiMeta.modelFallback;
    apiMeta.modelFallbackReason = apiMeta.modelFallbackReason || renderResult.meta.apiMeta.modelFallbackReason || '';
    apiMeta.responseId = apiMeta.responseId || renderResult.meta.apiMeta.responseId || '';
    apiMeta.usage = Object.keys(apiMeta.usage || {}).length ? apiMeta.usage : (renderResult.meta.apiMeta.usage || {});
    apiMeta.requestedModel = apiMeta.requestedModel || renderResult.meta.apiMeta.requestedModel || '';
    apiMeta.providerResolvedModel = apiMeta.providerResolvedModel || renderResult.meta.apiMeta.providerResolvedModel || '';
    apiMeta.modelRoutingStage = apiMeta.modelRoutingStage || renderResult.meta.apiMeta.modelRoutingStage || '';
  }
  dbg.renderer = {
    usedFallback: !!renderResult.meta?.usedFallback,
    fallbackReason: renderResult.meta?.fallbackReason || '',
    rawPreview: String(renderResult.meta?.raw || '').slice(0, 220),
  };
  let fallbackStage = '';
  let technicalFallbackApplied = draftResult.meta?.finalDraftSource === 'technical_fallback';
  let replanned = false;
  let replannedReasonTags = [];
  let guard = validateOutput({ text: message, recentMessages: room.messages || [], skeleton: contentSkeleton });
  dbg.outputGuard = { blocked: !guard.ok, blockedReason: guard.reason };
  if (!guard.ok) {
    const retryRender = await renderStyle({ client, turnTask, turnPlan, draft, evidencePack, state, recentMessages: room.messages || [], sessionId, contentSkeleton });
    message = retryRender.message;
    guard = validateOutput({ text: message, recentMessages: room.messages || [], skeleton: contentSkeleton });
    dbg.outputGuard = { blocked: !guard.ok, blockedReason: guard.reason };
    if (!guard.ok) {
      dbg.fallbackUsed = true;
      dbg.fallbackReason = `output_guard_${guard.reason}`;
      fallbackStage = 'output_guard';
      message = buildRoleFallback({ turnTask, state, recentMessages: room.messages || [], evidencePack });
      const hard = validateOutput({ text: message, recentMessages: room.messages || [], skeleton: contentSkeleton });
      if (!hard.ok) {
        message = structuredRender(turnTask, draft, state, evidencePack, turnPlan, sessionId, contentSkeleton);
      }
    }
  }
  let evalResult = await evaluateTurn({ client, turnTask, state, draft, renderedText: message, evidencePack, recentMessages: room.messages || [] });

  if (!evalResult.passed) {
    const REPLAN_TAGS = [
      'generic_critical_talk', 'no_contradiction', 'no_question_or_branch',
      '病例相关性弱', 'targetPoint低信息量', '互动承接弱', '临床优先级错误',
      '优先级不清', '缺少病例锚点', '教学追问不足',
    ];
    const needsReplan = (evalResult.tags || []).some((t) => REPLAN_TAGS.includes(t));
    const replannedTurnPlan = needsReplan ? makeTurnPlan({
      turnTask: {
        ...turnTask,
        targetPoint: 'case_opening_agenda',
        targetSpeaker: '全体同学',
      },
      state,
      reasoningContext,
      recentMessages: room.messages || [],
      roleMemory: roleMem,
      activitySignal,
    }) : turnPlan;
    if (needsReplan) {
      replanned = true;
      replannedReasonTags = evalResult.tags || [];
      turnPlan = replannedTurnPlan;
      dbg.turnPlan.replanned = true;
      dbg.turnPlan.replanTags = replannedReasonTags;
    }
    draftResult = await generateRoleDraft({
      client,
      turnTask: {
        ...turnTask,
        objective: `${turnTask.objective}；修正要求：${evalResult.retrySuggestion || '提升针对性与可执行性'}`,
      },
      turnPlan: replannedTurnPlan,
      contentSkeleton,
      reasoningContext,
      state,
      evidencePack,
      recentExcerpts: recentExcerpts(room),
      recentMessages: room.messages || [],
    });
    draft = draftResult.draft;
    if (draftResult.meta?.apiMeta) Object.assign(apiMeta, { ...apiMeta, ...draftResult.meta.apiMeta });
    renderResult = await renderStyle({ client, turnTask, turnPlan: replannedTurnPlan, draft, evidencePack, state, recentMessages: room.messages || [], sessionId, contentSkeleton });
    message = renderResult.message;
    if (renderResult.meta?.apiMeta) Object.assign(apiMeta, { ...apiMeta, ...renderResult.meta.apiMeta });
    guard = validateOutput({ text: message, recentMessages: room.messages || [], skeleton: contentSkeleton });
    if (!guard.ok) {
      dbg.fallbackUsed = true;
      dbg.fallbackReason = `retry_guard_${guard.reason}`;
      fallbackStage = 'output_guard';
      message = buildRoleFallback({ turnTask, state, recentMessages: room.messages || [], evidencePack });
    }
    evalResult = await evaluateTurn({ client, turnTask, state, draft, renderedText: message, evidencePack, recentMessages: room.messages || [] });
  }

  const selectedRole = toPublicRole(turnTask.roleType);
  const displayName = toDisplayName(turnTask.roleType);
  state = updateDiscussionState(state, room, {
    turnCount: (state.turnCount || 0) + 1,
    speakerHistory: [...(state.speakerHistory || []), selectedRole].slice(-12),
    evidenceRefs: (evidencePack.items || []).map((it) => ({
      source: it.source,
      title: it.title,
      chunkId: it.chunkId,
      score: it.score,
    })),
  });
  stateBySession.set(sessionId, state);
  roleMemoryBySession.set(
    sessionId,
    updateRoleMemory(roleMem, { roleType: turnTask.roleType, draft, skeleton: contentSkeleton })
  );
  recordMetrics({
    parseFailed: !draftResult.meta?.parseOk,
    technicalFallback: draftResult.meta?.finalDraftSource === 'technical_fallback',
    legacyTemplateFallback: draftResult.meta?.finalDraftSource === 'legacy_template_fallback',
  });
  dbg.metrics = getMetrics();

  if (pblConfig.debug) {
    console.log(`[PBL][TurnTask] ${JSON.stringify(turnTask)}`);
    console.log(`[PBL][Evidence] count=${evidencePack.items.length} insufficient=${evidencePack.evidenceInsufficient}`);
    console.log(`[PBL][RoleDraft] ${JSON.stringify(draft)}`);
    console.log(`[PBL][Eval] ${JSON.stringify(evalResult)}`);
    console.log(`[PBL][Debug] ${JSON.stringify(dbg)}`);
    console.log(`[PBL][Output] ${message}`);
  }

  return {
    sessionId,
    routeName: 'socket.message.auto_ai',
    pipelineVersion: PIPELINE_VERSION,
    modelUsed: client.enabled() ? (apiMeta.actualModel || pblConfig.modelThinking) : 'fallback-no-model',
    roleName: displayName,
    roleKey: selectedRole,
    message,
    draft,
    eval: evalResult,
    debug: dbg,
    turnPlan,
    reasoningContext,
    stateSnapshot: state,
    evidencePack,
    apiMeta,
    triggerReason: options.triggerReason || '',
    modelPolicy: pblConfig.modelPolicy,
    modelRoutingStage: apiMeta.modelRoutingStage || '',
    providerPolicy: pblConfig.providerPolicy,
    metrics: dbg.metrics,
    contentSkeleton,
    fallbackStage,
    technicalFallbackApplied,
    speechAct,
    dialogueMove,
    mainContradiction: reasoningContext?.mainContradiction || '',
    contradictionType: reasoningContext?.contradictionType || '',
    replanned,
    replannedReasonTags,
    sourceMode,
    relayAttempted: relayMeta.relayAttempted,
    relaySucceeded: relayMeta.relaySucceeded,
    relayLatencyMs: relayMeta.relayLatencyMs,
    relayAdapterName: relayMeta.relayAdapterName,
    relayAbortReason: relayMeta.relayAbortReason || '',
    relayPageReused: relayMeta.relayPageReused,
    relayReadMode: relayMeta.relayReadMode,
    providerName: relayMeta.providerName || (sourceMode === 'web_relay' ? 'web_relay_deepseek' : 'longcat'),
    relayRequestId: relayMeta.relayRequestId || '',
    chunkPlan: pblConfig.chunkedSend ? planChunks({
      roleKey: selectedRole,
      finalText: message,
      contentSkeleton,
      chunkPolicy: {
        minChunks: contentSkeleton?.speakingConstraints?.minChunks ?? (selectedRole === 'ai_teacher' ? 2 : 1),
        maxChunks: contentSkeleton?.speakingConstraints?.maxChunks ?? (selectedRole === 'ai_teacher' ? 4 : 3),
        maxLen: 150,
      },
    }) : { chunks: [{ chunkId: `${Date.now()}_1`, chunkIndex: 1, totalChunks: 1, chunkType: 'analysis', text: message, dependsOnPrev: false, isFinalChunk: true }], chunkCount: 1, chunkTypes: ['analysis'], chunkingReason: 'disabled', chunkedSendEnabled: false },
  };
}

function ensureState(room) {
  const sessionId = getSessionId(room);
  if (!stateBySession.has(sessionId)) {
    const state = updateDiscussionState(null, room, { sessionId });
    stateBySession.set(sessionId, state);
  }
  return stateBySession.get(sessionId);
}

function getState(sessionId) {
  return stateBySession.get(sessionId);
}

function setState(sessionId, state) {
  stateBySession.set(sessionId, state);
}

function clearState(sessionId) {
  stateBySession.delete(sessionId);
}

module.exports = {
  nextTurn,
  ensureState,
  getState,
  setState,
  clearState,
  ROLE_MAP,
};
