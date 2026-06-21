const { defaultDiscussionState, STAGES } = require('./types');

function pickTopic(messages = []) {
  const first = messages.find((m) => (m.type || 'text') === 'text' && m.content);
  if (!first) return '未命名病例';
  return String(first.content).replace(/\s+/g, ' ').slice(0, 48);
}

function extractCaseFacts(messages = []) {
  const merged = messages
    .filter((m) => (m.type || 'text') === 'text')
    .map((m) => String(m.content || ''))
    .join('\n');
  const getLine = (regexp) => (merged.match(regexp)?.[1] || '').trim();
  const chiefComplaint = getLine(/(?:主诉|chief complaint|因)(?:[:：]\s*|)([^\n。]{4,80})(?:入院|就诊|$)/i);
  const historyPresentIllness = getLine(/(?:现病史|HPI)[:：]\s*([^\n]+)/i);
  const vitals = {};
  const getVital = (k, re) => {
    const m = merged.match(re);
    if (m?.[1]) vitals[k] = m[1].trim();
  };
  getVital('T', /(?:体温|T)\s*[=:：]?\s*([0-9]{2}\.?[0-9]?\s*℃?)/i);
  getVital('HR', /(?:心率|HR)\s*[=:：]?\s*([0-9]{2,3}\s*(?:次\/分|bpm)?)/i);
  getVital('R', /(?:呼吸|R)\s*[=:：]?\s*([0-9]{1,2}\s*(?:次\/分)?)/i);
  getVital('BP', /(?:血压|BP)\s*[=:：]?\s*([0-9]{2,3}\s*\/\s*[0-9]{2,3}(?:\s*mmHg)?)/i);
  getVital('SpO2', /(?:SpO2|血氧(?:饱和度)?)[\s=:：]*([0-9]{2,3}\s*%)/i);

  const labPatterns = [
    { key: 'Hb', re: /Hb[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*(?:g\/L|g\/dL)?)/ig },
    { key: 'PLT', re: /PLT[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*(?:x10\^?9\/L)?)/ig },
    { key: 'PT', re: /PT[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*s?)/ig },
    { key: 'APTT', re: /APTT[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*s?)/ig },
    { key: '纤维蛋白原', re: /纤维蛋白原[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*(?:g\/L)?)/ig },
    { key: 'D-二聚体', re: /D-?二聚体[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*(?:mg\/L|ug\/mL)?)/ig },
    { key: '乳酸', re: /乳酸[\s=:：]*([0-9]+(?:\.[0-9]+)?\s*(?:mmol\/L)?)/ig },
  ];
  const labs = [];
  for (const item of labPatterns) {
    const re = item.re;
    let m;
    while ((m = re.exec(merged)) != null) {
      labs.push(`${item.key} ${m[1]}`.trim());
      if (labs.length >= 12) break;
    }
    if (labs.length >= 12) break;
  }

  const bleedingVolume = getLine(/(?:出血量|失血量)[^0-9]{0,8}([0-9]{2,5}\s*(?:ml|mL))/i);
  const urineOutput = getLine(/(?:尿量)[^0-9]{0,8}([0-9]{1,4}\s*(?:ml|mL|ml\/h|mL\/h))/i);
  const lactate = getLine(/(?:乳酸)[^0-9]{0,4}([0-9]+(?:\.[0-9]+)?\s*(?:mmol\/L)?)/i);
  const potentialDx = [];
  const dxTerms = ['DIC', '弥散性血管内凝血', '失血性休克', '脓毒症', '产后出血', '凝血障碍'];
  dxTerms.forEach((d) => {
    if (merged.toUpperCase().includes(d.toUpperCase()) || merged.includes(d)) potentialDx.push(d);
  });

  return {
    chiefComplaint,
    historyPresentIllness,
    pastHistory: [],
    meds: [],
    allergies: [],
    vitals,
    physicalExam: [],
    labs,
    imaging: [],
    bleedingVolume,
    urineOutput,
    lactate,
    potentialDx,
  };
}

function guessStage(state, messages = []) {
  const text = messages.map((m) => m.content || '').join('\n');
  const hasHypo = state.hypotheses.length >= 2;
  const hasChief = !!state.caseFacts.chiefComplaint;
  if (state.stage === 'information_gathering' && hasChief && hasHypo) return 'differential_diagnosis';
  if (state.stage === 'differential_diagnosis' && /(检查|化验|影像|workup)/.test(text)) return 'tests_and_workup';
  if (state.stage === 'tests_and_workup' && /(治疗|方案|用药|干预)/.test(text)) return 'treatment_plan';
  if (state.stage === 'treatment_plan' && /(风险|并发症|不良反应)/.test(text)) return 'risk_and_complications';
  if (state.stage === 'risk_and_complications' && /(总结|反思|收尾)/.test(text)) return 'summary_and_reflection';
  return STAGES.includes(state.stage) ? state.stage : 'information_gathering';
}

function summarizeRecent(messages = []) {
  const recent = messages.filter((m) => (m.type || 'text') === 'text').slice(-8);
  const s = recent.map((m) => `${m.sender?.name || m.userName || '未知'}: ${String(m.content || '').slice(0, 80)}`).join(' | ');
  const joined = recent.map((m) => String(m.content || '')).join('\n');
  const facts = [];
  const bp = joined.match(/(?:血压|BP)[^0-9]{0,8}([0-9]{2,3}\s*\/\s*[0-9]{2,3})/i)?.[1];
  const hb = joined.match(/Hb[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const plt = joined.match(/PLT[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const fib = joined.match(/纤维蛋白原[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  const lac = joined.match(/乳酸[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  if (bp) facts.push(`BP${bp}`);
  if (hb) facts.push(`Hb${hb}`);
  if (plt) facts.push(`PLT${plt}`);
  if (fib) facts.push(`FIB${fib}`);
  if (lac) facts.push(`Lac${lac}`);
  return [s, facts.join(' ')].filter(Boolean).join(' | ');
}

function extractQuestions(messages = []) {
  const recent = messages.filter((m) => (m.type || 'text') === 'text').slice(-20);
  return recent
    .filter((m) => /[?？]/.test(m.content || ''))
    .map((m) => String(m.content || '').slice(0, 70))
    .slice(-6);
}

function extractHypotheses(messages = []) {
  const recent = messages.filter((m) => (m.type || 'text') === 'text').slice(-30);
  const keywords = ['肺炎', '脓毒症', '心衰', '急性冠脉综合征', '肺栓塞', 'DKA', '中毒', '脑卒中', 'DIC', '失血性休克', '产后出血', '凝血障碍'];
  const found = [];
  for (const msg of recent) {
    for (const k of keywords) {
      if ((msg.content || '').includes(k) && !found.includes(k)) found.push(k);
    }
  }
  return found.slice(0, 6).map((name) => ({
    name,
    priority: 'medium',
    status: 'active',
    support: [],
    against: [],
    nextChecks: [],
  }));
}

function updateDiscussionState(prevState, room, patch = {}) {
  const messages = room?.messages || [];
  const state = prevState || defaultDiscussionState(room.roomCode || room.sessionId || 'unknown', pickTopic(messages));
  const caseFacts = extractCaseFacts(messages);
  const hypotheses = extractHypotheses(messages);
  const unresolvedQuestions = extractQuestions(messages);
  const speakerHistory = messages
    .filter((m) => (m.type || 'text') === 'text')
    .slice(-8)
    .map((m) => m.sender?.role || m.userType || 'unknown');

  const merged = {
    ...state,
    ...patch,
    topic: state.topic || pickTopic(messages),
    caseFacts: {
      ...state.caseFacts,
      ...caseFacts,
    },
    hypotheses: hypotheses.length ? hypotheses : state.hypotheses,
    unresolvedQuestions,
    messageSummary: summarizeRecent(messages),
    speakerHistory,
    stage: guessStage(state, messages),
    lastUpdatedAt: new Date().toISOString(),
  };
  return merged;
}

module.exports = {
  updateDiscussionState,
  summarizeRecent,
};
