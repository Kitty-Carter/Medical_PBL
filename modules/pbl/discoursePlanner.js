function pickIntent(turnTask, reasoningContext) {
  const agenda = reasoningContext.agenda;
  if (turnTask.roleType === 'teacher') {
    if (agenda === '总结反思') return 'summarize';
    if (/优先级|风险/.test(agenda)) return 'triage';
    return ['probe', 'reframe', 'prioritize'][turnTask.shouldSummarize ? 2 : (turnTask.wordLimit.max % 3)];
  }
  if (turnTask.roleType === 'student_critic') {
    if (agenda === '争论假设') return 'challenge';
    return 'refine';
  }
  if (agenda === '确定检查路径') return 'evidence_probe';
  return 'risk_alert';
}

function pickClinicalAnchors(state, reasoningContext, turnTask) {
  const anchors = [];
  const facts = state.caseFacts || {};
  const snap = reasoningContext.currentSnapshot || {};
  (snap.keyFactCluster || []).slice(0, 3).forEach((x) => anchors.push(x));
  if (snap.currentTopRisk) anchors.push(`当前最高风险:${snap.currentTopRisk}`);
  (snap.immediateThreats || []).forEach((x) => anchors.push(x));
  if (facts.vitals?.BP) anchors.push(`血压${facts.vitals.BP}`);
  if (facts.vitals?.SpO2) anchors.push(`SpO2 ${facts.vitals.SpO2}`);
  if (facts.lactate) anchors.push(`乳酸${facts.lactate}`);
  (facts.labs || []).slice(0, 2).forEach((x) => anchors.push(x));
  if (!anchors.length) {
    (reasoningContext.caseUnderstanding.vitalsSummary || []).slice(0, 3).forEach((x) => anchors.push(x));
  }
  if (!anchors.length) anchors.push('当前关键生命体征趋势');
  return anchors.slice(0, turnTask.roleType === 'teacher' ? 3 : 2);
}

function pickReasoningMove(turnTask, reasoningContext) {
  const contradiction = reasoningContext.keyContradictions?.[0] || reasoningContext.caseUnderstanding.contradictions?.[0] || '';
  const loop = reasoningContext.openLoops?.[0] || '';
  if (turnTask.roleType === 'teacher') {
    if (reasoningContext.caseUnderstanding.severityLevel === 'high') {
      return contradiction || '当前风险信号与既有判断不一致，需先锁定救命优先级';
    }
    return contradiction || '先收敛争点，再把下一步验证动作说清楚';
  }
  if (turnTask.roleType === 'student_critic') {
    return contradiction || (loop ? `未闭环问题是“${loop.slice(0, 26)}”` : '当前结论证据不足，存在过早收敛');
  }
  return loop
    ? `需要补齐“${loop.slice(0, 26)}”对应的证据链与复评节点`
    : '补充红旗监测、检查优先级与动态复评证据链';
}

function pickPedagogicalMove(turnTask, reasoningContext) {
  if (turnTask.roleType !== 'teacher') return '';
  if (reasoningContext.agenda === '总结反思') return '总结+反事实追问';
  if (reasoningContext.caseUnderstanding.severityLevel === 'high') return '优先级纠偏+分叉提问';
  return '分层提示+闭环追问';
}

function pickTeacherMeetingAction(turnTask, reasoningContext, roleMemory = {}, activitySignal = {}) {
  if (turnTask.shouldSummarize) return 'checkpoint_summary';
  if ((reasoningContext.urgentConflicts || []).length) return 'priority_correction';
  if ((reasoningContext.pathwaySplitPoints || []).length) return 'branch_question';
  if ((reasoningContext.openLoops || []).length >= 3) return 'commitment_check';
  if (activitySignal.repetitiveRoleRisk) return 'role_assignment';
  const last = roleMemory.teacher?.lastMeetingAction || '';
  if (last === 'focus_set') return 'branch_question';
  return 'focus_set';
}

function pickStudentStance(turnTask, roleMemory = {}, reasoningContext) {
  const contradictions = (reasoningContext.keyContradictions || []).length + (reasoningContext.urgentConflicts || []).length;
  const revisedBefore = (turnTask.roleType === 'student_critic' ? roleMemory.B?.revisionHistory : roleMemory.C?.revisionHistory) || [];
  if (contradictions >= 2) return 'challenge';
  if (revisedBefore.length >= 2) return 'revise';
  return turnTask.roleType === 'student_critic' ? 'counter_hypothesis' : 'stabilize_discussion';
}

function makeTurnPlan({ turnTask, state, reasoningContext, recentMessages, roleMemory = {}, activitySignal = {} }) {
  const intent = pickIntent(turnTask, reasoningContext);
  const anchors = pickClinicalAnchors(state, reasoningContext, turnTask);
  const latestHuman = [...(recentMessages || [])].reverse().find((m) => m.type === 'text' && !String(m.sender?.role || '').startsWith('ai_'));
  const openingMode = turnTask.targetPoint === 'case_opening_agenda';
  const replyTarget = openingMode ? {
    speaker: '全体同学',
    point: 'case_opening_agenda',
  } : {
    speaker: turnTask.targetSpeaker || latestHuman?.sender?.name || '同学',
    point: turnTask.targetPoint || String(latestHuman?.content || '当前关键判断').slice(0, 70),
  };
  const uncertainty = reasoningContext.caseUnderstanding.severityLevel === 'high' ? 'medium' : 'high';
  const stance = turnTask.roleType === 'teacher' ? '部分同意' : (turnTask.roleType === 'student_critic' ? '反对' : '部分同意');
  const lexicalAvoid = (state.messageSummary || '').split(/[|，。；\s]+/).filter(Boolean).slice(-6);
  const teacherMeetingAction = turnTask.roleType === 'teacher'
    ? pickTeacherMeetingAction(turnTask, reasoningContext, roleMemory, activitySignal)
    : '';
  const studentStanceHint = turnTask.roleType !== 'teacher'
    ? pickStudentStance(turnTask, roleMemory, reasoningContext)
    : '';
  const participationBoost = turnTask.roleType === 'teacher'
    ? '点名至少一位学生回应分叉路径'
    : '主动承接前一位发言并提出推进问题';

  return {
    speakerRole: turnTask.roleType,
    meetingIntent: intent,
    agenda: reasoningContext.agenda,
    replyTarget,
    clinicalAnchors: anchors,
    reasoningMove: pickReasoningMove(turnTask, reasoningContext),
    pedagogicalMove: pickPedagogicalMove(turnTask, reasoningContext),
    uncertaintyLevel: uncertainty,
    stance,
    nextAction: reasoningContext.nextBestAction,
    branchQuestion: `${reasoningContext.branches.A} / ${reasoningContext.branches.B}`,
    toneControls: turnTask.roleType === 'student_critic' ? 'direct' : (turnTask.roleType === 'teacher' ? 'calm_authoritative' : 'steady_practical'),
    lexicalAvoid,
    mustAvoid: ['规则词泄露', '模板指令句', '泛泛下一步建议'],
    openLoops: reasoningContext.openLoops.slice(0, 3),
    commitments: reasoningContext.commitments.slice(-3),
    replyTargetScore: Number(turnTask.targetPointScore || 0),
    openingMode,
    keyContradictions: (reasoningContext.keyContradictions || []).slice(0, 2),
    urgentConflicts: (reasoningContext.urgentConflicts || []).slice(0, 2),
    pathwaySplitPoints: (reasoningContext.pathwaySplitPoints || []).slice(0, 2),
    currentSnapshot: reasoningContext.currentSnapshot || {},
    meetingActionType: teacherMeetingAction,
    studentStanceHint,
    participationBoost,
  };
}

module.exports = {
  makeTurnPlan,
};
