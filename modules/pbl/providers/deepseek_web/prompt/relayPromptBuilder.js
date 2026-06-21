const { ROLE_CARDS, FORBIDDEN_PHRASES } = require('./promptTemplates');

function safeList(arr, n = 4) {
  return (arr || []).filter(Boolean).slice(0, n);
}

function buildRelayPrompt(input = {}) {
  const roleKey = input.roleKey || 'ai_teacher';
  const card = ROLE_CARDS[roleKey] || ROLE_CARDS.ai_teacher;
  const mainContradiction = input.mainContradiction || '当前主矛盾未闭环';
  const agendaStage = input.agendaStage || input.turnPlan?.agenda || '澄清事实';
  const keyFacts = safeList(input.keyFactCluster || input.turnPlan?.clinicalAnchors || input.reasoningContext?.currentSnapshot?.keyFactCluster, 4);
  const openLoops = safeList(input.openLoops || input.reasoningContext?.openLoops, 2);
  const replyTargetSpeaker = input.replyTarget?.speaker || input.turnPlan?.replyTarget?.speaker || '同学';
  const replyTargetPoint = input.replyTarget?.point || input.turnPlan?.replyTarget?.point || '当前观点';
  const speechAct = input.speechAct || input.turnPlan?.speechAct || '';
  const recent = safeList(input.recentExcerpts, 3);

  const lines = [
    '你正在进行医学PBL课堂讨论（教学训练场景，不是临床诊疗指令）。',
    `你现在的角色：${card.name}。角色任务：${card.mission}。`,
    `当前议程阶段：${agendaStage}`,
    `当前主矛盾（只推进1条）：${mainContradiction}`,
    `承接对象：${replyTargetSpeaker}`,
    `承接内容：${String(replyTargetPoint).slice(0, 120)}`,
    speechAct ? `本轮speechAct：${speechAct}` : '',
    '',
    '关键事实锚点（必须至少引用1条具体事实）：',
    ...keyFacts.map((x) => `- ${x}`),
    '',
    openLoops.length ? '待闭环问题：' : '',
    ...openLoops.map((x) => `- ${x}`),
    '',
    recent.length ? '最近关键发言摘录：' : '',
    ...recent.map((x) => `- ${x}`),
    '',
    `动作链建议：${card.moveChain}`,
    `输出必须分段：按 [1]...[2]... 输出短消息，共 ${card.chunks} 条。`,
    '每条尽量单一动作，避免一条里既总结又追问又分工。',
    '语言风格：像真人课堂开会，不像论文或教材总结。',
    `禁止机械套话：${FORBIDDEN_PHRASES.join('、')}`,
    '至少包含1个追问，且必须具体。',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  buildRelayPrompt,
};
