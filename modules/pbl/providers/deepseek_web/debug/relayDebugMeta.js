function buildRelayDebugMeta(payload = {}) {
  return {
    sourceMode: 'deepseek_web',
    providerPolicy: payload.providerPolicy || '',
    relayAttempted: !!payload.relayAttempted,
    relaySucceeded: !!payload.relaySucceeded,
    relayLatencyMs: Number(payload.relayLatencyMs || 0),
    relayAdapterName: payload.relayAdapterName || 'deepseek_web',
    relaySelectorFallbackUsed: !!payload.relaySelectorFallbackUsed,
    queueWaitMs: Number(payload.queueWaitMs || 0),
    cooldownMsApplied: Number(payload.cooldownMsApplied || 0),
    jobState: payload.jobState || 'unknown',
    chunkCount: Number(payload.chunkCount || 0),
    chunkTypes: payload.chunkTypes || [],
    triggerReason: payload.triggerReason || '',
    triggerRuleMatched: payload.triggerRuleMatched || '',
    speechAct: payload.speechAct || '',
    mainContradiction: payload.mainContradiction || '',
    keyFactCluster: (payload.keyFactCluster || []).slice(0, 4),
    interruptedByUser: !!payload.interruptedByUser,
    abortReason: payload.abortReason || '',
  };
}

module.exports = {
  buildRelayDebugMeta,
};
