function buildContradictions({ snapshot, caseUnderstanding, state }) {
  const keyContradictions = [];
  const urgentConflicts = [];
  const pathwaySplitPoints = [];

  const sum = String(state?.messageSummary || '');
  if (snapshot?.latestPerfusionStatus?.perfusionStatus === 'poor' && /观察|先等等|先不急/.test(sum)) {
    keyContradictions.push('灌注风险已高，但讨论仍偏向观察等待');
  }
  if (snapshot?.latestCoagulationStatus?.coagulopathyRisk && snapshot?.latestBleedingStatus?.isActiveBleeding) {
    keyContradictions.push('持续出血与凝血异常并存，单一路径无法解释全部风险');
  }
  if ((snapshot?.latestVitals?.SBP || 999) < 90 && (snapshot?.latestPerfusionStatus?.lactate || 0) >= 4) {
    keyContradictions.push('血压恶化与高乳酸并存，不能停留在初始稳定印象');
  }
  (caseUnderstanding?.contradictions || []).forEach((x) => keyContradictions.push(typeof x === 'string' ? x : (x?.text || String(x).slice(0, 80))));

  if (snapshot?.currentSeverity === 'shock' || snapshot?.triagePriority === 'immediate') {
    urgentConflicts.push('先稳定循环/氧合 vs 先细化病因命名');
  }
  if ((snapshot?.immediateThreats || []).length) {
    urgentConflicts.push('先处理器官低灌注 vs 先扩展鉴别列表');
  }

  pathwaySplitPoints.push('若30-60分钟复评乳酸/血压恶化 -> 升级抢救路径');
  pathwaySplitPoints.push('若关键指标改善 -> 进入精细鉴别与去除无效假设');

  const kc = Array.from(new Set(keyContradictions)).slice(0, 4);
  const uc = Array.from(new Set(urgentConflicts)).slice(0, 3);
  const ps = Array.from(new Set(pathwaySplitPoints)).slice(0, 3);
  const mainContradiction = kc[0] || uc[0] || ps[0] || '路径分叉尚未闭环';
  const contradictionType = kc[0] ? 'key_contradiction' : (uc[0] ? 'urgent_conflict' : 'pathway_split');

  return {
    keyContradictions: kc,
    urgentConflicts: uc,
    pathwaySplitPoints: ps,
    mainContradiction,
    contradictionType,
  };
}

module.exports = {
  buildContradictions,
};
