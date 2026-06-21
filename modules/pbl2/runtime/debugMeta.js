// PBL2 debugMeta 组装器（完整版）
const config = require('../config/config');

function assembleDebugMeta(result, context = {}) {
  if (!config.debug) return undefined;

  const { state } = context;

  return {
    routeName: context.routeName || 'pbl2.nextTurnV2',
    pipelineVersion: config.pipelineVersion,
    provider: 'deepseek',
    modelPlanner: config.deepseek.modelReasoner,
    modelRenderer: config.deepseek.modelChat,
    usagePlanner: result.usagePlanner || {},
    usageRenderer: result.usageRenderer || {},
    speakerRole: result.roleKey,
    agendaStage: result.agendaStage,
    aiPasteSuspected: result.aiPasteSuspected || false,
    mainContradiction: (result.turnPlan?.mainContradiction || '').slice(0, 100),
    keyFactCluster: result.turnPlan?.keyFactCluster || [],
    openLoopsCount: state?.openLoops?.length || 0,
    openLoopsPreview: (state?.openLoops || []).slice(0, 2).map(l => l.question),
    retries: 0,
    retryReasons: [],
    rewriteCount: result.rewriteCount || 0,
    rewriteReasons: result.validationErrors || [],
    chunkCount: result.chunks?.length || 0,
    chunkTypes: result.chunks?.map(c => c.type) || [],
    interruptedByUser: context.interruptedByUser || false,
    speakerReason: result.speakerReason || '',
    duration: result.duration || 0,
    // P1 新增字段
    plannerMode: result.plannerMode || 'unknown',
    parseOk: result.parseOk !== false,
    parseModeTried: result.parseModeTried || [],
    renderOk: result.renderOk !== false,
    lockWaitMs: result.lockWaitMs || 0,
    lockHoldMs: result.lockHoldMs || 0,
    phaseTimings: result.phaseTimings || {},
  };
}

module.exports = { assembleDebugMeta };
