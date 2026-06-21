const FORBID_GENERIC = [
  '先稳定循环/氧合并同步完成最关键复评指标',
  '先救命和高危排除，细化鉴别放在后一步',
  '证据链尚未闭合',
];

function baseSkeleton({ roleKey, roleName, turnPlan, reasoningContext, state }) {
  const snap = reasoningContext.currentSnapshot || {};
  const contradictionType = turnPlan.keyContradictions?.length
    ? 'key_contradiction'
    : turnPlan.urgentConflicts?.length
      ? 'urgent_conflict'
      : 'pathway_split';
  const contradictionText = turnPlan.keyContradictions?.[0] || turnPlan.urgentConflicts?.[0] || turnPlan.pathwaySplitPoints?.[0] || '路径分叉尚未闭环';
  return {
    skeletonVersion: 'v1',
    roleKey,
    roleName,
    stage: turnPlan.agenda || reasoningContext.agenda || '',
    meetingIntent: turnPlan.meetingIntent || '',
    replyTarget: {
      targetType: 'case_text',
      targetName: turnPlan.replyTarget?.speaker || '同学',
      targetClaim: String(turnPlan.replyTarget?.point || '').slice(0, 90),
    },
    contextWindowSummary: {
      recentConsensus: [],
      recentDisputes: (reasoningContext.urgentConflicts || []).slice(0, 2),
      unansweredQuestions: (reasoningContext.openLoops || []).slice(0, 3),
    },
    currentSnapshotRef: {
      severityLevel: snap.currentSeverity || '',
      latestFactTimestampTag: snap.latestFactTimestampTag || '',
      keyFactCluster: (snap.keyFactCluster || []).slice(0, 4),
      topRisk: snap.currentTopRisk || '',
      unresolvedKillers: (snap.unresolvedKillers || []).slice(0, 3),
    },
    contradictionAnchor: {
      type: contradictionType,
      text: contradictionText,
    },
    mustInclude: {
      factAnchorLine: (snap.keyFactCluster || [])[0] || '关键危重事实待补全',
      contradictionLine: contradictionText,
      actionLine: turnPlan.nextAction || '先完成关键复评并重排行动',
      questionLine: turnPlan.branchQuestion || '若指标恶化你优先改哪一步？',
    },
    speakingConstraints: {
      tone: 'calm_evidence',
      maxSentences: 6,
      minSentences: 3,
      lengthHint: 'medium',
      avoidPhrases: FORBID_GENERIC,
      lexicalCooldown: (turnPlan.lexicalAvoid || []).slice(0, 6),
    },
    qualityChecksRequired: {
      requireFactBinding: true,
      requireContradiction: true,
      requireNextAction: true,
      requireQuestionOrBranch: true,
      requireRoleDistinctiveness: true,
    },
    debugTags: [],
    usedTargetPointAsPrimary: false,
  };
}

function buildTeacherSkeleton(ctx) {
  const b = baseSkeleton(ctx);
  const action = ctx.turnPlan?.meetingActionType || (b.meetingIntent === 'summarize'
    ? 'conflict_summarize'
    : b.meetingIntent === 'triage'
      ? 'priority_correction'
      : b.meetingIntent === 'probe'
        ? 'branch_question'
        : 'focus_set');
  const snap = ctx.reasoningContext?.currentSnapshot || {};
  const mainContra = ctx.reasoningContext?.mainContradiction || b.contradictionAnchor?.text || '路径分叉尚未闭环';
  const turnPlan = ctx.turnPlan || {};
  return {
    ...b,
    skeletonType: 'TeacherContentSkeleton',
    speakingConstraints: { ...b.speakingConstraints, tone: 'authoritative_warm', maxSentences: 7, maxChunks: 4, minChunks: 2 },
    meetingActionType: action,
    replyTarget: {
      speaker: turnPlan.replyTarget?.speaker || b.replyTarget?.targetName || '同学',
      quoteSnippet: turnPlan.replyTarget?.point?.slice(0, 60) || '',
      whyThisMatters: turnPlan.reasoningMove || mainContra,
    },
    acknowledge: {
      confirmPart: '肯定有效观察',
      correctionHook: turnPlan.clinicalAnchors?.[0] || mainContra,
    },
    priorityFrame: {
      currentStage: ctx.reasoningContext?.agenda || '处置优先级',
      mainRisk: snap.currentTopRisk || '未闭环',
      mainContradiction: mainContra,
    },
    teachingAction: {
      agendaFocus: mainContra?.slice(0, 50) || '本轮锁定一个关键问题',
      taskingToYu: '抓漏洞/过早收敛',
      taskingToPeng: '补证据链/复评节点',
    },
    nextAction: {
      immediateStep: turnPlan.nextAction || '先完成关键复评',
      whyNow: mainContra,
    },
    branchQuestion: {
      conditionA: '关键指标恶化',
      actionA: '升级抢救路径',
      conditionB: '关键指标改善',
      actionB: '进入精细鉴别',
    },
    teacherGoalThisTurn: {
      primaryGoal: '锁定当前优先级并推进分叉决策',
      successCriteria: ['学生表态路径选择', '给出可执行下一步'],
    },
    moderationMoves: {
      acknowledgeWhat: ['肯定有效观察'],
      correctWhat: ['纠正过早收敛或优先级偏差'],
      assignToRoles: ['B同学先抓漏洞', 'C同学补监测与复评', '每位同学必须给路径选择与理由'],
      enforcePriority: ['先处理高危威胁再细化鉴别'],
    },
    branchDesign: {
      branchACondition: '关键指标恶化',
      branchAPath: '升级抢救与高危路径',
      branchBCondition: '关键指标改善',
      branchBPath: '进入精细鉴别和收敛',
      whyThisSplitMatters: '决定处置节奏与风险暴露',
    },
    commitmentPrompt: {
      askWho: 'all',
      askFormat: 'choose_path_and_reason',
      promptLine: b.mustInclude.questionLine,
    },
    teacherVoiceHints: {
      canUseClinicalTeachingPearl: true,
      canReferenceCommonPitfall: true,
      mustAvoidGenericPreach: true,
    },
  };
}

function buildYuSkeleton(ctx, roleMemory = {}) {
  const b = baseSkeleton(ctx);
  const stance = ctx.turnPlan?.studentStanceHint || (roleMemory.lastStance ? 'revise' : 'challenge');
  const turnPlan = ctx.turnPlan || {};
  const mainContra = ctx.reasoningContext?.mainContradiction || b.contradictionAnchor?.text || '推理跳步或证据不足';
  return {
    ...b,
    skeletonType: 'YuContentSkeleton',
    speakingConstraints: { ...b.speakingConstraints, tone: 'sharp_rational', maxChunks: 3, minChunks: 1, mustIncludeStance: true, mustIncludeFact: true, mustIncludeQuestion: true },
    stance: { type: stance === 'challenge' ? 'disagree' : (stance === 'revise' ? 'partial_disagree' : 'agree'), target: turnPlan.replyTarget?.speaker || '同学' },
    contradictionAttack: { contradiction: mainContra, riskIfWrong: '过早收敛', evidenceGap: '关键证据/时序未闭环' },
    challengeQuestion: { directQuestion: b.mustInclude.questionLine || '你用什么证据/指标排除？' },
    logicCritiqueFocus: {
      focusType: 'premature_closure',
      critiqueLine: b.mustInclude.contradictionLine,
    },
    hypothesisBoardMove: {
      keepHypotheses: [],
      downgradeHypotheses: ['过早单一路径假设'],
      addHypotheses: ['并发路径假设'],
      rationaleFacts: b.currentSnapshotRef.keyFactCluster.slice(0, 2),
    },
    evidenceDemand: {
      missingEvidence: b.currentSnapshotRef.unresolvedKillers.slice(0, 2),
      whatWouldChangeMyMind: ['关键指标改善并与判断一致'],
    },
    interactionMove: {
      respondToTeacher: '承接老师的优先级要求',
      respondToPeng: '检验证据链是否闭环',
      directChallengeQuestion: b.mustInclude.questionLine,
    },
    yuVoiceHints: {
      style: 'sharp_but_rational',
      mustBeEvidenceAware: true,
      avoidPureProvocation: true,
    },
  };
}

function buildPengSkeleton(ctx, roleMemory = {}) {
  const b = baseSkeleton(ctx);
  const stance = ctx.turnPlan?.studentStanceHint || (roleMemory.lastStance ? 'partial_agree' : 'support');
  const turnPlan = ctx.turnPlan || {};
  const mainContra = ctx.reasoningContext?.mainContradiction || b.contradictionAnchor?.text || '证据链或复评节点缺口';
  const snap = ctx.reasoningContext?.currentSnapshot || {};
  return {
    ...b,
    skeletonType: 'PengContentSkeleton',
    speakingConstraints: { ...b.speakingConstraints, tone: 'calm_evidence', maxChunks: 3, minChunks: 1, mustIncludeOperationalStep: true, mustIncludeFact: true },
    supplementTo: { speaker: turnPlan.replyTarget?.speaker || '同学', whatToSupplement: mainContra },
    evidenceChain: {
      anchorFacts: (snap.keyFactCluster || []).slice(0, 4),
      interpretation: mainContra,
      linkToRisk: snap.currentTopRisk || '',
    },
    operationalPlan: {
      priorityChecks: turnPlan.clinicalAnchors || [],
      reassessmentWindow: '30-60分钟',
      triggersForEscalation: snap.immediateThreats || [],
    },
    stanceAction: stance,
    evidenceChainFocus: {
      chainType: 'monitoring_plan',
      chainLine: b.mustInclude.factAnchorLine,
    },
    monitoringPlan: {
      priorityMetrics: b.currentSnapshotRef.keyFactCluster.slice(0, 3),
      reassessmentWindow: '30-60分钟',
      escalationTriggers: ['血压继续下降', '乳酸继续上升', '尿量持续偏低'],
      deescalationClues: ['指标趋势改善且与临床一致'],
    },
    complicationReminder: {
      canMissWhat: b.currentSnapshotRef.unresolvedKillers.slice(0, 2),
      consequenceLine: '漏评会导致错误降级或延迟升级',
    },
    interactionMove: {
      patchWhatInYuOrTeacher: '补上监测闭环与可执行阈值',
      evidenceBasedQuestion: b.mustInclude.questionLine,
    },
    pengVoiceHints: {
      style: 'calm_precise_evidence',
      emphasizeOperationality: true,
      avoidAbstractLecture: true,
    },
  };
}

module.exports = {
  buildTeacherSkeleton,
  buildYuSkeleton,
  buildPengSkeleton,
};
