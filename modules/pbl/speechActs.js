/**
 * 话语动作层（Speech Act Layer）
 * 每轮先决定“这轮 AI 在会议里要做什么”，再决定“怎么说”
 */

const TEACHER_ACTS = [
  'acknowledge',           // 点名承接
  'priority_correction',   // 纠偏优先级
  'agenda_focus',          // 本轮只锁定一个关键问题
  'tasking',               // 分工给榆/澎
  'branch_question',       // A/B分叉追问
  'mini_summary',          // 阶段小结
];

const YU_ACTS = [
  'stance',                // 同意/部分同意/反对
  'contradiction_challenge',// 抓逻辑漏洞、危险病因未排除
  'alternative_hypothesis', // 替代假设
  'evidence_attack',       // 证据/时序/标准冲突
  'challenge_question',    // 锋利追问
];

const PENG_ACTS = [
  'supplement',            // 补关键事实
  'evidence_chain',        // 串联体征/化验/病理/风险
  'operational_next_step', // 检查优先级/复评节点
  'risk_alert',            // 并发症/漏诊风险
  'closure_question',      // 补闭环追问或收束
];

function pickTeacherSpeechAct(turnPlan, reasoningContext, triggerReason) {
  if (turnPlan?.openingMode || triggerReason === 'meeting_opening_mode') return 'agenda_focus';
  if (turnPlan?.shouldSummarize) return 'mini_summary';
  if ((reasoningContext?.urgentConflicts || []).length) return 'priority_correction';
  if ((reasoningContext?.pathwaySplitPoints || []).length) return 'branch_question';
  if (turnPlan?.meetingActionType === 'role_assignment') return 'tasking';
  if (turnPlan?.meetingActionType === 'focus_set') return 'agenda_focus';
  if (triggerReason === 'redirect_from_noise') return 'agenda_focus';
  return 'acknowledge';
}

function pickYuSpeechAct(turnPlan, roleMemory, reasoningContext) {
  const contradictions = (reasoningContext?.keyContradictions || []).length + (reasoningContext?.urgentConflicts || []).length;
  if (contradictions >= 2) return 'contradiction_challenge';
  if (roleMemory?.revisionHistory?.length >= 2) return 'stance';
  return 'evidence_attack';
}

function pickPengSpeechAct(turnPlan, roleMemory, reasoningContext) {
  const openLoops = (reasoningContext?.openLoops || []).length;
  if (openLoops >= 4) return 'evidence_chain';
  if ((reasoningContext?.currentSnapshot?.unresolvedKillers || []).length) return 'risk_alert';
  return 'operational_next_step';
}

function resolveSpeechAct(roleKey, ctx) {
  const { turnPlan = {}, reasoningContext = {}, roleMemory = {}, triggerReason = '' } = ctx;
  if (roleKey === 'ai_teacher') {
    return pickTeacherSpeechAct(turnPlan, reasoningContext, triggerReason);
  }
  if (roleKey === 'ai_student_B') {
    return pickYuSpeechAct(turnPlan, roleMemory.B || {}, reasoningContext);
  }
  if (roleKey === 'ai_student_C') {
    return pickPengSpeechAct(turnPlan, roleMemory.C || {}, reasoningContext);
  }
  return 'unknown';
}

module.exports = {
  TEACHER_ACTS,
  YU_ACTS,
  PENG_ACTS,
  resolveSpeechAct,
};
