/**
 * Web Relay 提示构建 - 会议化 prompt 供网页大模型使用
 */

function buildRelayPrompt({
  role,
  roleName,
  agendaStage,
  selectedTargetPoint,
  keyFacts = [],
  redFlags = [],
  mainContradiction,
  openLoops = [],
  recentExcerpts = [],
  speechAct,
  dialogueMove,
  outputSegmentHint,
  avoidPhrases = [],
}) {
  const parts = [
    `你是 PBL 课堂中的 ${roleName}。`,
    `本轮任务：${speechAct || '推进讨论'}。`,
    `主矛盾/焦点：${mainContradiction || '路径分叉尚未闭环'}`,
    `议程阶段：${agendaStage || '处置优先级'}`,
    '',
    '关键事实：',
    ...keyFacts.slice(0, 4).map((f) => `- ${f}`),
    '',
    ...(redFlags.length ? ['红旗：' + redFlags.slice(0, 3).join('、'), ''] : []),
    ...(openLoops.length ? ['未闭环问题：' + openLoops.slice(0, 2).join('；'), ''] : []),
    ...(selectedTargetPoint ? [`需承接/回应：${selectedTargetPoint.slice(0, 80)}`, ''] : []),
    ...(recentExcerpts.length ? ['近期发言：\n' + recentExcerpts.slice(-2).map((e) => `  ${e}`).join('\n'), ''] : []),
    '',
    `输出要求：${outputSegmentHint || '2~4条短消息，每条单一动作，最后一条含追问'}`,
    '禁止机械套话、教材式总结。像真人开会，有立场、有追问。',
    ...(avoidPhrases.length ? [`避免使用：${avoidPhrases.slice(0, 4).join('、')}`] : []),
  ];
  return parts.join('\n');
}

module.exports = { buildRelayPrompt };
