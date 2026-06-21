const { buildCurrentCriticalSnapshot } = require('./currentSnapshot');
const { buildContradictions } = require('./contradictionBuilder');

function inferAgenda(state, caseUnderstanding) {
  if (state.turnCount % 5 === 4) return '总结反思';
  if (caseUnderstanding.severityLevel === 'high') return '处置优先级';
  if ((state.unresolvedQuestions || []).length > 2) return '闭环未决问题';
  if (state.stage === 'information_gathering') return '澄清事实';
  if (state.stage === 'differential_diagnosis') return '争论假设';
  if (state.stage === 'tests_and_workup') return '确定检查路径';
  if (state.stage === 'treatment_plan') return '优化处理方案';
  if (state.stage === 'risk_and_complications') return '并发症风险复盘';
  return '总结反思';
}

function buildOpenLoops(state, room) {
  const q = [...(state.unresolvedQuestions || [])];
  const recent = (room.messages || []).filter((m) => m.type === 'text').slice(-8).map((m) => m.content || '');
  recent.forEach((x) => {
    if (/[?？]/.test(x)) q.push(String(x).slice(0, 60));
  });
  const joined = recent.join('\n');
  if (!/(乳酸|尿量|意识|血压|SpO2)/.test(joined)) q.push('关键灌注指标未闭环');
  if (!/(PT|APTT|PLT|纤维蛋白原|D-?二聚体)/i.test(joined)) q.push('凝血风险评估未闭环');
  if (!/(下一步|先做|路径|分叉|A\/B)/.test(joined)) q.push('处置分叉路径未回答');
  return Array.from(new Set(q)).slice(0, 12);
}

function inferCommitments(room) {
  const commits = [];
  const recent = (room.messages || []).filter((m) => m.type === 'text').slice(-10);
  recent.forEach((m) => {
    const text = String(m.content || '');
    const speaker = m.sender?.name || '未知';
    const stance =
      /不考虑|排除|不是/.test(text) ? '反对' :
      /倾向|考虑|支持/.test(text) ? '支持' :
      /可能|保留/.test(text) ? '保留' : '中性';
    if (/(休克|DIC|肺栓塞|ACS|卒中|DKA|HHS|出血|感染)/.test(text)) {
      commits.push({ speaker, stance, point: text.slice(0, 70) });
    }
  });
  return commits.slice(-8);
}

function buildHypothesisBoard(state, caseUnderstanding, evidencePack) {
  const board = (state.hypotheses || []).map((h) => ({
    name: h.name,
    priority: h.priority || 'medium',
    status: h.status || 'active',
    support: [...(h.support || [])],
    against: [...(h.against || [])],
    nextChecks: [...(h.nextChecks || [])],
  }));
  caseUnderstanding.redFlags.forEach((rf) => {
    board.forEach((h) => {
      if (/休克|DIC|出血/.test(h.name)) h.support.push(`红旗: ${rf}`);
    });
  });
  (evidencePack.items || []).slice(0, 3).forEach((e) => {
    board.forEach((h) => {
      if (e.excerpt && h.name && e.excerpt.includes(h.name)) h.support.push(`证据片段: ${e.title}`);
    });
  });
  return board.slice(0, 8);
}

function buildReasoningContext({ state, room, caseUnderstanding, evidencePack }) {
  const agenda = inferAgenda(state, caseUnderstanding);
  const snapshot = buildCurrentCriticalSnapshot(state, caseUnderstanding);
  const contradictions = buildContradictions({ snapshot, caseUnderstanding, state });
  const openLoops = buildOpenLoops(state, room).concat(snapshot.unresolvedKillers || []).concat(contradictions.urgentConflicts || []);
  const commitments = inferCommitments(room);
  const hypothesisBoard = buildHypothesisBoard(state, caseUnderstanding, evidencePack);
  const nextBestAction = snapshot.currentSeverity === 'critical' || caseUnderstanding.severityLevel === 'high'
    ? '先稳定循环/氧合并同步完成最关键复评指标'
    : '优先完成最能改变诊疗路径的一项检查';
  const branchA = '若关键指标恶化，升级高危处置路径';
  const branchB = '若指标改善，进入精细鉴别与收敛';
  const riskMonitors = caseUnderstanding.redFlags.length
    ? caseUnderstanding.redFlags
    : ['生命体征趋势', '器官灌注指标', '并发症红旗'];

  return {
    agenda,
    openLoops,
    commitments,
    hypothesisBoard,
    nextBestAction,
    branches: { A: branchA, B: branchB },
    riskMonitors,
    caseUnderstanding,
    currentSnapshot: snapshot,
    keyContradictions: contradictions.keyContradictions,
    urgentConflicts: contradictions.urgentConflicts,
    pathwaySplitPoints: contradictions.pathwaySplitPoints,
    mainContradiction: contradictions.mainContradiction,
    contradictionType: contradictions.contradictionType,
    openLoops: Array.from(new Set(openLoops)).slice(0, 10),
  };
}

module.exports = {
  buildReasoningContext,
};
