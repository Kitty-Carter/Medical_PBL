function toNum(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(metric, value, unit) {
  const u = String(unit || '').trim();
  if (!u) return { value, unit: '', inferred: true };
  return { value, unit: u, inferred: false };
}

function validateFact(fact, context = {}) {
  const suspicious = [];
  const { metric, value, unit } = fact;
  if (value == null || !Number.isFinite(value)) {
    return { ok: false, suspicious: ['empty_or_nan_value'], fact };
  }
  if (metric === 'SpO2') {
    const arrestCtx = /ECMO|濒死|心肺复苏|极重度低氧|监护脱落|脱机/.test(context.text || '');
    if (value === 0 && !arrestCtx) suspicious.push('spo2_zero_parse_error');
    if (value < 30 && !arrestCtx) suspicious.push('spo2_implausibly_low');
    if (value > 100) suspicious.push('spo2_out_of_range');
  }
  if (metric === 'BP') {
    const pair = String(fact.rawValue || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
    if (!pair) return { ok: false, suspicious: ['invalid_bp_format'], fact };
  }
  if ((metric === 'HR' || metric === 'RR') && (value < 10 || value > 260)) suspicious.push('vital_out_of_range');
  if (metric === 'Lactate' && value > 25) suspicious.push('lactate_out_of_range');
  if (metric === 'Hb' && value > 250) suspicious.push('hb_out_of_range');
  if (metric === 'PLT' && value > 2000) suspicious.push('plt_out_of_range');
  if (metric === 'PT' && value > 200) suspicious.push('pt_out_of_range');
  if (metric === 'APTT' && value > 300) suspicious.push('aptt_out_of_range');
  if (metric === 'Fibrinogen' && value > 20) suspicious.push('fib_out_of_range');
  if (metric === 'UrineOutput' && value > 3000) suspicious.push('urine_out_of_range');
  const nu = normalizeUnit(metric, value, unit);
  return {
    ok: true,
    suspicious,
    fact: {
      ...fact,
      value: nu.value,
      unit: nu.unit,
      inferred: !!nu.inferred,
    },
  };
}

function buildTimestampTag(text = '') {
  const t = String(text || '');
  if (/复查|再次|再测|复测|复评/.test(t)) return '复查时';
  if (/半小时后|30分钟后/.test(t)) return '半小时后';
  if (/1小时后|一小时后|60分钟后/.test(t)) return '1小时后';
  if (/入院时|急诊时/.test(t)) return '入院时';
  if (/产后/.test(t)) return '产后';
  return '当前';
}

/** 过滤可疑事实，返回可用于主锚点的清洁事实列表 */
function filterSuspiciousFromAnchors(factsOrTimeline = [], options = {}) {
  const { allowSuspicious = false } = options;
  if (allowSuspicious) return factsOrTimeline;
  return factsOrTimeline.filter((f) => !(f.suspicious && f.suspicious.length));
}

/** 从 caseUnderstanding.factTimeline 构建可用的 clinicalAnchors，排除可疑值 */
function buildCleanClinicalAnchors(caseUnderstanding = {}, snapshotKeyFactCluster = []) {
  const timeline = caseUnderstanding.factTimeline || [];
  const clean = filterSuspiciousFromAnchors(timeline);
  const anchors = [];
  clean.slice(-6).forEach((f) => {
    if (f.metric && f.rawValue != null) {
      anchors.push(`${f.metric} ${f.rawValue}${f.unit || ''}`);
    }
  });
  (snapshotKeyFactCluster || []).forEach((line) => {
    if (line && !anchors.includes(line)) anchors.push(line);
  });
  return anchors.slice(0, 4);
}

module.exports = {
  toNum,
  validateFact,
  buildTimestampTag,
  filterSuspiciousFromAnchors,
  buildCleanClinicalAnchors,
};
