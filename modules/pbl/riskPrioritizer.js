function scoreSnapshot(snapshot) {
  let score = 0;
  const reasons = [];
  const b = snapshot?.latestVitals || {};
  if (b.SBP != null && b.SBP < 90) {
    score += 4;
    reasons.push(`SBP ${b.SBP} 提示休克风险`);
  }
  if (snapshot?.latestPerfusionStatus?.lactate != null && snapshot.latestPerfusionStatus.lactate >= 4) {
    score += 4;
    reasons.push(`乳酸 ${snapshot.latestPerfusionStatus.lactate} 提示灌注不足`);
  }
  if (snapshot?.latestPerfusionStatus?.urineOutput != null && snapshot.latestPerfusionStatus.urineOutput < 30) {
    score += 2;
    reasons.push(`尿量 ${snapshot.latestPerfusionStatus.urineOutput} mL/h 偏低`);
  }
  if (snapshot?.latestBleedingStatus?.isActiveBleeding) {
    score += 3;
    reasons.push('存在持续出血/近期大量失血');
  }
  if (snapshot?.latestCoagulationStatus?.coagulopathyRisk) {
    score += 3;
    reasons.push('凝血异常提示并发风险');
  }
  if (snapshot?.latestVitals?.SpO2 != null && snapshot.latestVitals.SpO2 < 92) {
    score += 2;
    reasons.push(`SpO2 ${snapshot.latestVitals.SpO2}% 偏低`);
  }
  const triagePriority = score >= 9 ? 'immediate' : score >= 6 ? 'urgent' : 'standard';
  const topRisk = reasons[0] || '高危病因未排除';
  return {
    topRisk,
    topRiskReasons: reasons.slice(0, 4),
    triagePriority,
    riskScoreBreakdown: { total: score },
  };
}

module.exports = {
  scoreSnapshot,
};
