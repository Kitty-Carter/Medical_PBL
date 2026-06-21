const { ROLE_MAP } = require('./types');
const { isLowInformationMessage, scoreMessageInformation } = require('./triggerEngine');

function pickLastHumanPoint(room) {
  const textMsgs = (room.messages || []).filter((m) => m.type === 'text').slice(-20);
  const stage = room.pblControl?.agendaStage || '';
  const riskRe = /(低血压|血压\s*\d{2,3}\/\d{2,3}|休克|乳酸|少尿|意识|持续出血|SpO2|PLT|PT|APTT|纤维蛋白原|DIC)/i;
  const contradictionRe = /(但是|却|反而|矛盾|不一致|为何不是|如何排除)/;
  const stageRe = /处置优先级|闭环|风险|检查|鉴别/;
  const candidates = textMsgs
    .filter((m) => !String(m.sender?.role || '').startsWith('ai_'))
    .map((m, idx) => {
      const t = String(m.content || '');
      const base = scoreMessageInformation(t);
      const recencyWeight = (idx + 1) / Math.max(textMsgs.length, 1) * 3;
      const riskWeight = riskRe.test(t) ? 4 : 0;
      const contradictionWeight = contradictionRe.test(t) ? 2.5 : 0;
      const stageWeight = stageRe.test(stage) && /优先|下一步|先做|风险|分叉/.test(t) ? 1.8 : 0;
      return { m, s: base + recencyWeight + riskWeight + contradictionWeight + stageWeight };
    })
    .sort((a, b) => b.s - a.s);
  const target = candidates[0]?.m;
  const targetScore = Number(candidates[0]?.s || 0);
  if (!target) return { targetSpeaker: '同学', targetPoint: 'case_opening_agenda', targetPointScore: 0 };
  const rawPoint = String(target.content || '').slice(0, 70);
  if (isLowInformationMessage(rawPoint) || targetScore < 1.8) {
    return { targetSpeaker: '同学', targetPoint: 'case_opening_agenda', targetPointScore: targetScore };
  }
  return {
    targetSpeaker: target.sender?.name || target.userName || '同学',
    targetPoint: rawPoint,
    targetPointScore: targetScore,
  };
}

function detectGapType(state) {
  const summary = `${state.messageSummary}\n${state.unresolvedQuestions.join('\n')}`;
  if (/(证据|依据|指南|研究)/.test(summary)) return 'logic';
  if (/(并发症|风险|红旗|危险)/.test(summary)) return 'risk';
  return 'balanced';
}

function buildWordLimit(roleType, shouldSummarize) {
  if (roleType === 'teacher') {
    return shouldSummarize ? { min: 160, max: 260 } : { min: 80, max: 160 };
  }
  return { min: 70, max: 150 };
}

function fallbackTurnTask({ state, room, preferredRole }) {
  const summarizeTurn = state.turnCount > 0 && state.turnCount % 4 === 0;
  const gapType = detectGapType(state);
  const { targetSpeaker, targetPoint, targetPointScore } = pickLastHumanPoint(room);
  const history = state.speakerHistory || [];
  const lastAI = [...history].reverse().find((r) => r === 'ai_student_B' || r === 'ai_student_C');
  let roleKey = 'ai_student_B';
  if (summarizeTurn) {
    roleKey = 'teacher';
  } else if (preferredRole && ROLE_MAP[preferredRole]) {
    roleKey = preferredRole;
  } else if (gapType === 'risk') {
    roleKey = lastAI === 'ai_student_C' ? 'ai_student_B' : 'ai_student_C';
  } else if (gapType === 'logic') {
    roleKey = lastAI === 'ai_student_B' ? 'ai_student_C' : 'ai_student_B';
  } else {
    roleKey = lastAI === 'ai_student_B' ? 'ai_student_C' : 'ai_student_B';
  }

  const roleMeta = roleKey === 'teacher' ? ROLE_MAP.teacher : ROLE_MAP[roleKey];
  const shouldAdvanceStage = summarizeTurn;
  const objective = summarizeTurn
    ? '阶段性总结当前推理进展并给出下一阶段分叉问题'
    : '主动回应具体观点并推动讨论向可验证步骤前进';

  return {
    roleName: roleMeta.roleName,
    roleType: roleMeta.roleType,
    objective,
    targetSpeaker,
    targetPoint,
    targetPointScore,
    allowedMoves: ['回应具体观点', '指出证据缺口', '提出A/B分叉问题', '给出下一步检查建议', '主动追问并点名承接'],
    forbiddenMoves: ['直接下最终结论', '虚构最新指南/更新结论', '重复空泛套话'],
    questionStyle: summarizeTurn ? 'branching' : (gapType === 'risk' ? 'risk_probe' : 'evidence_probe'),
    wordLimit: buildWordLimit(roleMeta.roleType, summarizeTurn),
    shouldSummarize: summarizeTurn,
    shouldAdvanceStage,
  };
}

module.exports = {
  fallbackTurnTask,
};
