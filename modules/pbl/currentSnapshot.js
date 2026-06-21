const { scoreSnapshot } = require('./riskPrioritizer');

function pickLatest(timeline, metric) {
  const rows = (timeline || []).filter((x) => x.metric === metric && !x.suspicious?.length);
  return rows.length ? rows[rows.length - 1] : null;
}

function pickTrend(timeline, metric) {
  const rows = (timeline || []).filter((x) => x.metric === metric && !x.suspicious?.length);
  if (rows.length < 2) return null;
  const a = rows[rows.length - 2].value;
  const b = rows[rows.length - 1].value;
  if (a == null || b == null) return null;
  if (b > a) return 'up';
  if (b < a) return 'down';
  return 'flat';
}

function buildCurrentCriticalSnapshot(state, caseUnderstanding) {
  const timeline = caseUnderstanding?.factTimeline || [];
  const latestBP = pickLatest(timeline, 'BP');
  const bpMatch = String(latestBP?.rawValue || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  const sbp = bpMatch ? Number(bpMatch[1]) : null;
  const dbp = bpMatch ? Number(bpMatch[2]) : null;
  const latestHR = pickLatest(timeline, 'HR');
  const latestSpO2 = pickLatest(timeline, 'SpO2');
  const latestLactate = pickLatest(timeline, 'Lactate');
  const latestBleed = pickLatest(timeline, 'Bleeding');
  const latestUO = pickLatest(timeline, 'UrineOutput');
  const latestPLT = pickLatest(timeline, 'PLT');
  const latestPT = pickLatest(timeline, 'PT');
  const latestAPTT = pickLatest(timeline, 'APTT');
  const latestFib = pickLatest(timeline, 'Fibrinogen');

  const perfusionStatus = (sbp != null && sbp < 90) || (latestLactate?.value != null && latestLactate.value >= 4)
    ? 'poor'
    : ((sbp != null && sbp < 100) || (latestLactate?.value != null && latestLactate.value >= 2)) ? 'borderline' : 'unknown';
  const bleedingStatus = {
    isActiveBleeding: !!latestBleed || /持续出血|渗血/.test(state?.messageSummary || ''),
    amountMl: latestBleed?.value || null,
  };
  const coagulationStatus = {
    coagulopathyRisk: !!((latestFib?.value != null && latestFib.value < 1.5) || (latestPLT?.value != null && latestPLT.value < 100) || (latestPT?.value != null && latestPT.value > 15) || (latestAPTT?.value != null && latestAPTT.value > 40)),
    plt: latestPLT?.value || null,
    pt: latestPT?.value || null,
    aptt: latestAPTT?.value || null,
    fibrinogen: latestFib?.value || null,
  };

  const immediateThreats = [];
  if (sbp != null && sbp < 90) immediateThreats.push(`低血压(SBP ${sbp})`);
  if (latestSpO2?.value != null && latestSpO2.value < 92) immediateThreats.push(`低氧(SpO2 ${latestSpO2.value}%)`);
  if (latestLactate?.value != null && latestLactate.value >= 4) immediateThreats.push(`高乳酸(${latestLactate.value})`);
  if (bleedingStatus.isActiveBleeding) immediateThreats.push('持续/近期大量出血');
  if (coagulationStatus.coagulopathyRisk) immediateThreats.push('凝血恶化风险');

  const unresolvedKillers = [];
  if (sbp == null) unresolvedKillers.push('休克程度未量化');
  if (latestLactate?.value == null) unresolvedKillers.push('乳酸趋势未闭环');
  if (latestUO?.value == null) unresolvedKillers.push('尿量与灌注状态未闭环');
  if (!unresolvedKillers.length) unresolvedKillers.push('关键处置分叉未表态');

  const trends = [
    { metric: 'BP', trend: pickTrend(timeline, 'BP') },
    { metric: 'Lactate', trend: pickTrend(timeline, 'Lactate') },
    { metric: 'UrineOutput', trend: pickTrend(timeline, 'UrineOutput') },
  ].filter((x) => x.trend);
  const timelineSummary = timeline.slice(-6).map((x) => `${x.timestampTag}-${x.metric}:${x.rawValue}${x.unit ? x.unit : ''}`);
  const latestFactTimestampTag = timeline.length ? timeline[timeline.length - 1].timestampTag : '当前';
  const keyFactCluster = [];
  if (sbp != null) keyFactCluster.push(`最新BP ${sbp}/${dbp ?? '?'} mmHg`);
  if (latestLactate?.value != null) keyFactCluster.push(`最新乳酸 ${latestLactate.value}${latestLactate.unit || 'mmol/L'}`);
  if (latestUO?.value != null) keyFactCluster.push(`最新尿量 ${latestUO.value}${latestUO.unit || 'mL/h'}`);
  if (coagulationStatus.coagulopathyRisk) keyFactCluster.push(`凝血异常: PLT ${coagulationStatus.plt ?? '-'} / FIB ${coagulationStatus.fibrinogen ?? '-'}`);
  if (!keyFactCluster.length) keyFactCluster.push('关键危重事实待补全');
  const risk = scoreSnapshot({
    latestVitals: { SBP: sbp, DBP: dbp, HR: latestHR?.value ?? null, SpO2: latestSpO2?.value ?? null },
    latestPerfusionStatus: { lactate: latestLactate?.value ?? null, urineOutput: latestUO?.value ?? null },
    latestBleedingStatus: bleedingStatus,
    latestCoagulationStatus: coagulationStatus,
  });
  const currentSeverity = risk.triagePriority === 'immediate' ? 'shock' : (risk.triagePriority === 'urgent' ? 'shock_risk' : 'unstable');
  return {
    currentSeverity,
    latestVitals: { BP: latestBP?.rawValue || '', SBP: sbp, DBP: dbp, HR: latestHR?.value || null, SpO2: latestSpO2?.value || null },
    latestBleedingStatus: bleedingStatus,
    latestPerfusionStatus: { lactate: latestLactate?.value || null, urineOutput: latestUO?.value || null, perfusionStatus },
    latestCoagulationStatus: coagulationStatus,
    immediateThreats,
    currentTopRisk: risk.topRisk,
    topRiskReasons: risk.topRiskReasons,
    triagePriority: risk.triagePriority,
    riskScoreBreakdown: risk.riskScoreBreakdown,
    unresolvedKillers,
    timelineSummary,
    latestFactTimestampTag,
    keyFactCluster: keyFactCluster.slice(0, 4),
    trends,
  };
}

module.exports = {
  buildCurrentCriticalSnapshot,
};
