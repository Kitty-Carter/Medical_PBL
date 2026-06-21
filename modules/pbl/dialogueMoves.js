/**
 * 对话推进动作（Dialogue Move）
 * 与 speechAct 配套，描述本轮要执行的具体动作链
 */

function buildTeacherDialogueMove(speechAct, turnPlan, reasoningContext) {
  const main = reasoningContext?.keyContradictions?.[0] || reasoningContext?.urgentConflicts?.[0] || '路径分叉未闭环';
  const next = turnPlan?.nextAction || '先完成关键复评并重排行动';
  const branch = turnPlan?.branchQuestion || '若关键指标恶化你如何升级路径？';
  const map = {
    acknowledge: { primary: 'acknowledge', secondary: 'branch_question', summary: '点名承接并追问' },
    priority_correction: { primary: 'priority_correction', secondary: 'branch_question', summary: '纠偏优先级并追问' },
    agenda_focus: { primary: 'agenda_focus', secondary: 'tasking', summary: '定焦点并分工' },
    tasking: { primary: 'tasking', secondary: 'branch_question', summary: '分工并追问' },
    branch_question: { primary: 'branch_question', secondary: null, summary: '分叉追问' },
    mini_summary: { primary: 'mini_summary', secondary: null, summary: '阶段小结' },
  };
  const move = map[speechAct] || map.acknowledge;
  return {
    primary: move.primary,
    secondary: move.secondary,
    summary: move.summary,
    mainContradiction: main,
    nextAction: next,
    branchQuestion: branch,
  };
}

function buildYuDialogueMove(speechAct, turnPlan, reasoningContext) {
  const main = reasoningContext?.keyContradictions?.[0] || reasoningContext?.urgentConflicts?.[0] || '推理跳步或证据不足';
  const map = {
    stance: { primary: 'stance', secondary: 'challenge_question', summary: '表态并追问' },
    contradiction_challenge: { primary: 'contradiction_challenge', secondary: 'challenge_question', summary: '抓矛盾并追问' },
    alternative_hypothesis: { primary: 'alternative_hypothesis', secondary: null, summary: '替代假设' },
    evidence_attack: { primary: 'evidence_attack', secondary: 'challenge_question', summary: '证据攻击并追问' },
    challenge_question: { primary: 'challenge_question', secondary: null, summary: '锋利追问' },
  };
  const move = map[speechAct] || map.contradiction_challenge;
  return {
    primary: move.primary,
    secondary: move.secondary,
    summary: move.summary,
    mainContradiction: main,
    challengeQuestion: turnPlan?.branchQuestion || '你用什么证据/指标排除？',
  };
}

function buildPengDialogueMove(speechAct, turnPlan, reasoningContext) {
  const main = reasoningContext?.keyContradictions?.[0] || '证据链或复评节点缺口';
  const map = {
    supplement: { primary: 'supplement', secondary: 'closure_question', summary: '补事实并收束追问' },
    evidence_chain: { primary: 'evidence_chain', secondary: 'operational_next_step', summary: '证据链+可执行下一步' },
    operational_next_step: { primary: 'operational_next_step', secondary: null, summary: '可执行下一步' },
    risk_alert: { primary: 'risk_alert', secondary: 'closure_question', summary: '风险提醒并收束追问' },
    closure_question: { primary: 'closure_question', secondary: null, summary: '收束追问' },
  };
  const move = map[speechAct] || map.evidence_chain;
  return {
    primary: move.primary,
    secondary: move.secondary,
    summary: move.summary,
    mainContradiction: main,
    operationalStep: turnPlan?.nextAction || '30-60分钟复评关键指标',
  };
}

function resolveDialogueMove(roleKey, speechAct, ctx) {
  const { turnPlan = {}, reasoningContext = {} } = ctx;
  if (roleKey === 'ai_teacher') return buildTeacherDialogueMove(speechAct, turnPlan, reasoningContext);
  if (roleKey === 'ai_student_B') return buildYuDialogueMove(speechAct, turnPlan, reasoningContext);
  if (roleKey === 'ai_student_C') return buildPengDialogueMove(speechAct, turnPlan, reasoningContext);
  return { primary: 'unknown', secondary: null, summary: '未知', mainContradiction: '' };
}

module.exports = {
  buildTeacherDialogueMove,
  buildYuDialogueMove,
  buildPengDialogueMove,
  resolveDialogueMove,
};
