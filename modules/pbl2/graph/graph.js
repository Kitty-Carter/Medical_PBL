// PBL2 主流程（自然体验版：planner直接输出segments）
const { ingestMessage } = require('./nodes/ingest');
const { updateStateFacts } = require('./nodes/facts');
const { detectStageAndLoops } = require('./nodes/stage');
const { decideNextSpeaker } = require('./nodes/speaker');
const { generateReply } = require('./nodes/planner');
const { emitChunks } = require('./nodes/emitter');

async function executePBLTurn(state, room, lockWaitMs = 0, opts = {}) {
  const graphState = { state, room, opts };
  const phaseTimings = {};

  // 节点1: ingest
  console.log('[Graph] Phase: ingest');
  const t1 = Date.now();
  const ingestResult = ingestMessage(graphState);
  graphState.ingestResult = ingestResult;
  phaseTimings.ingest = Date.now() - t1;

  // 节点2: facts
  console.log('[Graph] Phase: facts');
  const t2 = Date.now();
  const factsResult = updateStateFacts(graphState);
  graphState.factsResult = factsResult;
  phaseTimings.facts = Date.now() - t2;

  // 节点3: stage
  console.log('[Graph] Phase: stage');
  const t3 = Date.now();
  const stageResult = detectStageAndLoops(graphState);
  graphState.stageResult = stageResult;
  phaseTimings.stage = Date.now() - t3;

  // 节点4: speaker
  console.log('[Graph] Phase: speaker');
  const t4 = Date.now();
  const speakerDecision = decideNextSpeaker(graphState);
  graphState.speakerDecision = speakerDecision;
  phaseTimings.speaker = Date.now() - t4;

  // 节点5: planner - 直接生成 segments（一次性调用）
  console.log('[Graph] Phase: planner (生成segments)');
  const t5 = Date.now();
  const replyResult = await generateReply(graphState);
  graphState.segments = replyResult.segments;
  graphState.turnPlan = replyResult.turnPlan; // 保存 turnPlan
  graphState.usage = replyResult.usage;
  graphState.modelUsed = replyResult.modelUsed;
  graphState.parseOk = replyResult.parseOk;
  phaseTimings.planner = Date.now() - t5;
  console.log(`[Graph] Phase: planner完成 elapsed=${phaseTimings.planner}ms model=${replyResult.modelUsed}`);

  // 节点6: emitter - 分段发送
  console.log('[Graph] Phase: emitter');
  const t6 = Date.now();
  const emitResult = emitChunks(graphState);
  graphState.finalOutput = emitResult.finalOutput;
  phaseTimings.emitter = Date.now() - t6;

  // 更新状态
  state.lastSpeakers = state.lastSpeakers || [];
  state.lastSpeakers.push(speakerDecision.nextSpeaker);
  if (state.lastSpeakers.length > 10) {
    state.lastSpeakers = state.lastSpeakers.slice(-10);
  }

  state.aiRecentReplies = state.aiRecentReplies || [];
  state.aiRecentReplies.push(emitResult.finalOutput.fullMessage);
  if (state.aiRecentReplies.length > 12) {
    state.aiRecentReplies = state.aiRecentReplies.slice(-12);
  }

  // 添加到 transcript
  if (!state.transcript) state.transcript = [];
  state.transcript.push({
    roleKey: speakerDecision.nextSpeaker,
    content: emitResult.finalOutput.fullMessage,
    timestamp: Date.now(),
  });

  return {
    roleKey: emitResult.finalOutput.roleKey,
    roleName: emitResult.finalOutput.roleName,
    chunks: emitResult.finalOutput.chunks,
    fullMessage: emitResult.finalOutput.fullMessage,
    usage: replyResult.usage,
    modelUsed: replyResult.modelUsed,
    agendaStage: state.agendaStage,
    speakerReason: speakerDecision.reason,
    aiPasteSuspected: ingestResult.aiPasteSuspected,
    parseOk: replyResult.parseOk,
    phaseTimings,
    lockWaitMs,
  };
}

module.exports = { executePBLTurn };
