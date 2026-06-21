function buildTeachingRecommendations(analysis) {
  const rows = analysis?.scoreTable || [];
  const participation = analysis?.participation || [];
  const stats = analysis?.statistics || {};

  if (!rows.length) {
    return ['本次课堂暂无有效学生数据，建议先确保学生已成功加入房间并发言。'];
  }

  const lowMachine = [...rows].sort((a, b) => a.machineScore - b.machineScore).slice(0, 3);
  const highGap = [...rows]
    .map((r) => ({ ...r, gap: Math.abs((r.teacherScore || 0) - (r.machineScore || 0)) }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3);
  const lowQuestion = [...participation]
    .map((p) => ({
      ...p,
      rate: p.messageCount > 0 ? (p.questionCount / p.messageCount) : 0,
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3);

  const recs = [];
  recs.push(`建议优先关注机器评分偏低同学：${lowMachine.map((s) => `${s.name}(${s.machineScore})`).join('、')}。可通过定向追问提升其参与深度。`);
  recs.push(`建议复盘评分分歧较大同学：${highGap.map((s) => `${s.name}(差${s.gap})`).join('、')}。对照发言记录统一评分标准。`);
  recs.push(`建议鼓励提问不足同学：${lowQuestion.map((s) => `${s.name}(提问率${Math.round((s.rate || 0) * 100)}%)`).join('、')}。`);

  if ((stats.aiResponseRate || 0) < 25) {
    recs.push('AI 对学生提问响应率较低，建议教师在关键提问后增加“请AI点评此问题”的引导。');
  }
  if ((stats.participationStd || 0) > 3) {
    recs.push('发言分布不均衡，建议下一次课堂采用“轮次发言+限时总结”机制。');
  }
  return recs;
}

module.exports = { buildTeachingRecommendations };

