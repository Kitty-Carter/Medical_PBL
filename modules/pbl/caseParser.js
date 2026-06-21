const { toNum, validateFact, buildTimestampTag } = require('./clinicalValueValidator');

function collectText(messages = []) {
  return messages
    .filter((m) => (m.type || 'text') === 'text')
    .map((m) => String(m.content || ''))
    .join('\n');
}

function extractTimeline(text) {
  const lines = String(text || '').split(/\n+/);
  const events = [];
  const re = /(起病|发病|后|小时|天|入院|恶化|突然|进行性)/;
  lines.forEach((l) => {
    if (re.test(l) && l.trim().length > 6) {
      events.push(l.trim().slice(0, 80));
    }
  });
  return events.slice(0, 8);
}

function parseVital(text, name, re) {
  const m = String(text || '').match(re);
  return m?.[1] ? `${name}${m[1]}` : '';
}

function extractFactsFromLine(text, lineIdx) {
  const s = String(text || '');
  const facts = [];
  const bp = s.match(/(?:血压|BP)\s*[=:：]?\s*(\d{2,3}\s*\/\s*\d{2,3})\s*(mmHg)?/i);
  if (bp) facts.push({ metric: 'BP', rawValue: bp[1], value: toNum(bp[1]), unit: bp[2] || 'mmHg', lineIdx });
  const hr = s.match(/(?:心率|HR)\s*[=:：]?\s*(\d{2,3})\s*(次\/分|bpm)?/i);
  if (hr) facts.push({ metric: 'HR', rawValue: hr[1], value: toNum(hr[1]), unit: hr[2] || '次/分', lineIdx });
  const rr = s.match(/(?:呼吸|RR|R)\s*[=:：]?\s*(\d{1,2})\s*(次\/分)?/i);
  if (rr) facts.push({ metric: 'RR', rawValue: rr[1], value: toNum(rr[1]), unit: rr[2] || '次/分', lineIdx });
  const spo2 = s.match(/(?:SpO2|血氧(?:饱和度)?)\s*[=:：]?\s*(\d{2,3})\s*%/i);
  if (spo2) facts.push({ metric: 'SpO2', rawValue: spo2[1], value: toNum(spo2[1]), unit: '%', lineIdx });
  const temp = s.match(/(?:体温|T)\s*[=:：]?\s*(\d{2}(?:\.\d)?)\s*℃/i);
  if (temp) facts.push({ metric: 'T', rawValue: temp[1], value: toNum(temp[1]), unit: '℃', lineIdx });
  const hb = s.match(/Hb\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(g\/L|g\/dL)?/i);
  if (hb) facts.push({ metric: 'Hb', rawValue: hb[1], value: toNum(hb[1]), unit: hb[2] || 'g/L', lineIdx });
  const plt = s.match(/PLT\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(x10\^?9\/L)?/i);
  if (plt) facts.push({ metric: 'PLT', rawValue: plt[1], value: toNum(plt[1]), unit: plt[2] || 'x10^9/L', lineIdx });
  const pt = s.match(/PT\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(s|秒)?/i);
  if (pt) facts.push({ metric: 'PT', rawValue: pt[1], value: toNum(pt[1]), unit: pt[2] || 's', lineIdx });
  const aptt = s.match(/APTT\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(s|秒)?/i);
  if (aptt) facts.push({ metric: 'APTT', rawValue: aptt[1], value: toNum(aptt[1]), unit: aptt[2] || 's', lineIdx });
  const fib = s.match(/(?:纤维蛋白原|fibrinogen)\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(g\/L)?/i);
  if (fib) facts.push({ metric: 'Fibrinogen', rawValue: fib[1], value: toNum(fib[1]), unit: fib[2] || 'g/L', lineIdx });
  const dd = s.match(/D-?二聚体\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(mg\/L|ug\/mL)?/i);
  if (dd) facts.push({ metric: 'DDimer', rawValue: dd[1], value: toNum(dd[1]), unit: dd[2] || 'mg/L', lineIdx });
  const lac = s.match(/乳酸\s*[=:：]?\s*(\d+(?:\.\d+)?)\s*(mmol\/L)?/i);
  if (lac) facts.push({ metric: 'Lactate', rawValue: lac[1], value: toNum(lac[1]), unit: lac[2] || 'mmol/L', lineIdx });
  const bleed = s.match(/(?:出血量|失血量|持续出血)[^0-9]{0,8}(\d{2,4})\s*(mL|ml)/i);
  if (bleed) facts.push({ metric: 'Bleeding', rawValue: bleed[1], value: toNum(bleed[1]), unit: 'mL', lineIdx });
  const urine = s.match(/(?:尿量)[^0-9]{0,8}(\d{1,4})\s*(mL\/h|ml\/h|mL|ml)/i);
  if (urine) facts.push({ metric: 'UrineOutput', rawValue: urine[1], value: toNum(urine[1]), unit: urine[2] || 'mL/h', lineIdx });
  return facts;
}

function buildFactTimeline(messages = []) {
  const timeline = [];
  let suspiciousCount = 0;
  const suspiciousPreview = [];
  messages
    .filter((m) => (m.type || 'text') === 'text')
    .forEach((m, idx) => {
      const text = String(m.content || '');
      const tsTag = buildTimestampTag(text);
      const facts = extractFactsFromLine(text, idx);
      facts.forEach((f) => {
        const checked = validateFact(f, { text });
        if (!checked.ok) return;
        if (checked.suspicious.length) {
          suspiciousCount += 1;
          if (suspiciousPreview.length < 4) suspiciousPreview.push(`${f.metric}:${checked.suspicious.join('|')}`);
        }
        timeline.push({
          ...checked.fact,
          timestampTag: tsTag,
          sourceText: text.slice(0, 120),
          suspicious: checked.suspicious,
        });
      });
    });
  return {
    factTimeline: timeline,
    extractedFactsCount: timeline.length,
    suspiciousFactsCount: suspiciousCount,
    suspiciousFactsPreview: suspiciousPreview,
    factTimelineBuilt: timeline.length > 0,
  };
}

function extractRedFlags(text) {
  const flags = [];
  const patterns = [
    [/血压[^0-9]{0,4}([0-9]{2,3}\/[0-9]{2,3})/, (v) => `低血压(${v})`],
    [/SpO2[^0-9]{0,4}([0-9]{2}\%?)/i, (v) => `低氧(${v})`],
    [/乳酸[^0-9]{0,4}([0-9]+(?:\.[0-9]+)?)/, (v) => `高乳酸(${v})`],
    [/意识(?:模糊|障碍|改变)/, () => '意识异常'],
    [/持续出血|大出血|失血/, () => '持续/大量出血'],
    [/APTT[^0-9]{0,4}([0-9]+(?:\.[0-9]+)?)/i, (v) => `APTT延长(${v})`],
  ];
  for (const [re, mapFn] of patterns) {
    const m = String(text || '').match(re);
    if (m) flags.push(mapFn(m[1]));
  }
  return Array.from(new Set(flags)).slice(0, 8);
}

function extractContradictions(text) {
  const contradictions = [];
  const t = String(text || '');
  if (/不考虑休克|仅.*失血|先观察/.test(t) && /(乳酸|低血压|SpO2|意识)/.test(t)) {
    contradictions.push('对休克风险评估与灌注证据存在冲突');
  }
  if (/感染/.test(t) && /凝血|出血/.test(t) && !/并发症|DIC/.test(t)) {
    contradictions.push('关注感染但凝血并发症讨论不足');
  }
  if (/先治疗/.test(t) && !/检查|复评/.test(t)) {
    contradictions.push('处置方案先行但验证路径不足');
  }
  return contradictions.slice(0, 6);
}

function extractKnownUnknownImmediate(text, state) {
  const knownFacts = [];
  const unknownFacts = [];
  const immediateFacts = [];
  const t = String(text || '');
  const vitalTerms = ['血压', '心率', 'SpO2', '体温', '乳酸', 'Hb', 'PLT', 'PT', 'APTT', '纤维蛋白原'];
  vitalTerms.forEach((k) => {
    if (t.includes(k)) knownFacts.push(`已提及${k}`);
    else unknownFacts.push(`${k}信息缺失或未更新`);
  });
  const red = extractRedFlags(t);
  red.forEach((r) => immediateFacts.push(`需立即处理: ${r}`));
  if ((state?.unresolvedQuestions || []).length) {
    immediateFacts.push(`未闭环问题: ${state.unresolvedQuestions[0]}`);
  }
  return { knownFacts: knownFacts.slice(0, 10), unknownFacts: unknownFacts.slice(0, 8), immediateFacts: immediateFacts.slice(0, 8) };
}

function inferProblemFrame(text, redFlags) {
  const t = String(text || '');
  const frame = {
    diagnosis: [],
    severity: [],
    etiology: [],
    complications: [],
    priorities: [],
  };
  if (/胸痛|ACS|心梗|夹层|肺栓塞/i.test(t)) frame.diagnosis.push('急性胸痛三联鉴别');
  if (/卒中|言语不清|偏瘫|溶栓/.test(t)) frame.diagnosis.push('脑卒中分型与时间窗');
  if (/DKA|HHS|酮症|高渗/.test(t)) frame.diagnosis.push('代谢危象鉴别');
  if (/上消化道出血|呕血|黑便/.test(t)) frame.diagnosis.push('消化道出血来源与复苏');
  if (/产后|DIC|失血/.test(t)) frame.diagnosis.push('产科出血与凝血障碍');
  if (!frame.diagnosis.length) frame.diagnosis.push('核心病因与高危排除');
  if (redFlags.length) frame.severity.push('存在危重红旗，需先稳定生命体征');
  frame.priorities.push('先救命/先高危排除/先最能改变路径的信息');
  frame.complications.push('并发症与器官灌注趋势监测');
  return frame;
}

function parseCaseUnderstanding(state, room) {
  const messages = room?.messages || [];
  const text = collectText(messages);
  const factBundle = buildFactTimeline(messages);
  const timeline = extractTimeline(text);
  const redFlags = extractRedFlags(text);
  const contradictions = extractContradictions(text);
  const knownUnknown = extractKnownUnknownImmediate(text, state);
  const problemFrame = inferProblemFrame(text, redFlags);
  const vitalsSummary = [
    parseVital(text, 'BP', /(?:血压|BP)[^0-9]{0,6}([0-9]{2,3}\/[0-9]{2,3}(?:mmHg)?)/i),
    parseVital(text, 'HR', /(?:心率|HR)[^0-9]{0,6}([0-9]{2,3})/i),
    parseVital(text, 'SpO2', /SpO2[^0-9]{0,6}([0-9]{2,3}\%?)/i),
    parseVital(text, 'Lac', /乳酸[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i),
  ].filter(Boolean);
  const severityLevel = redFlags.length >= 2 ? 'high' : redFlags.length ? 'medium' : 'low';

  return {
    timeline,
    factTimeline: factBundle.factTimeline,
    extractedFactsCount: factBundle.extractedFactsCount,
    suspiciousFactsCount: factBundle.suspiciousFactsCount,
    suspiciousFactsPreview: factBundle.suspiciousFactsPreview,
    factTimelineBuilt: factBundle.factTimelineBuilt,
    severityLevel,
    redFlags,
    contradictions,
    ...knownUnknown,
    problemFrame,
    vitalsSummary,
  };
}

module.exports = {
  parseCaseUnderstanding,
};
