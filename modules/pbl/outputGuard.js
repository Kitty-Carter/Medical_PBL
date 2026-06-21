const LEAK_PATTERNS = [
  /先回应具体观点/,
  /避免空泛复述/,
  /指出证据是否足够/,
  /给出可执行的下一步检查/,
  /判断分叉/,
  /你提到的“.*”是关键点。?\s*-\s*先回应具体观点/s,
  /allowedMoves|forbiddenMoves|TurnTask|RoleDraft/i,
];
const GENERIC_PATTERNS = [
  /先稳定循环\/?氧合并同步完成最关键复评指标/,
  /先救命和高危排除，细化鉴别放在后一步/,
  /证据链尚未闭合/,
];

const ENTITY_PATTERN = /(血压|心率|脉搏|体温|血氧|SpO2|Hb|PLT|PT|APTT|纤维蛋白原|D-二聚体|乳酸|出血|休克|DIC|脓毒症|肺炎|栓塞|凝血|输血|补液|升压药|影像|CT|超声|检查)/i;

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, '').trim();
}

function similarity(a, b) {
  const A = normalizeText(a);
  const B = normalizeText(b);
  if (!A || !B) return 0;
  const minLen = Math.min(A.length, B.length);
  let same = 0;
  for (let i = 0; i < minLen; i++) {
    if (A[i] === B[i]) same += 1;
  }
  return same / Math.max(A.length, B.length);
}

function detectLeakage(text) {
  const s = String(text || '');
  return LEAK_PATTERNS.find((r) => r.test(s));
}

function validateOutput({ text, recentMessages = [], skeleton }) {
  const content = String(text || '').trim();
  if (content.length < 40) {
    return { ok: false, reason: 'too_short' };
  }
  const leak = detectLeakage(content);
  if (leak) {
    return { ok: false, reason: 'template_leakage' };
  }
  if (GENERIC_PATTERNS.some((r) => r.test(content))) {
    return { ok: false, reason: 'generic_critical_talk' };
  }
  if (skeleton?.mustInclude) {
    const must = skeleton.mustInclude;
    const hitFact = must.factAnchorLine ? content.includes(String(must.factAnchorLine).slice(0, 6)) : true;
    const hitContra = must.contradictionLine ? content.includes(String(must.contradictionLine).slice(0, 6)) : true;
    const hitAction = must.actionLine ? content.includes(String(must.actionLine).slice(0, 6)) : true;
    const hitQ = must.questionLine ? /[?？]/.test(content) : true;
    if (!(hitFact && hitContra)) return { ok: false, reason: 'weak_fact_binding' };
    if (!hitAction) return { ok: false, reason: 'no_meeting_action' };
    if (!hitQ) return { ok: false, reason: 'no_question_or_branch' };
  }
  if (!ENTITY_PATTERN.test(content)) {
    return { ok: false, reason: 'no_medical_entity' };
  }
  const latest = [...recentMessages].reverse().find((m) => m.type === 'text' && String(m.sender?.role || '').startsWith('ai_'));
  if (latest && similarity(content, latest.content || '') >= 0.6) {
    return { ok: false, reason: 'high_repetition' };
  }
  return { ok: true, reason: '' };
}

module.exports = {
  LEAK_PATTERNS,
  validateOutput,
  detectLeakage,
  ENTITY_PATTERN,
  similarity,
};
