const { safeJsonParse, sanitizeJsonLike } = require('./longcatClient');

function looksLikeDraft(obj) {
  return !!(
    obj
    && typeof obj === 'object'
    && obj.replyTo
    && typeof obj.replyTo === 'object'
    && Array.isArray(obj.reasoningBullets)
  );
}

function normalizeDraft(obj, defaults = {}) {
  const d = obj || {};
  return {
    replyTo: {
      speaker: d.replyTo?.speaker || defaults.speaker || '同学',
      point: d.replyTo?.point || defaults.point || '当前病例核心观点',
    },
    stance: d.stance || defaults.stance || '需先聚焦高危矛盾',
    reasoningBullets: Array.isArray(d.reasoningBullets) ? d.reasoningBullets.filter(Boolean).slice(0, 4) : [],
    evidenceNeed: Array.isArray(d.evidenceNeed) ? d.evidenceNeed.filter(Boolean).slice(0, 3) : [],
    questions: Array.isArray(d.questions) ? d.questions.filter(Boolean).slice(0, 2) : [],
    proposedNextStep: d.proposedNextStep || defaults.next || '',
    safetyNote: d.safetyNote || defaults.safetyNote || '',
  };
}

function parseStrictJson(raw, defaults = {}) {
  const parsed = safeJsonParse(raw);
  if (!looksLikeDraft(parsed)) return null;
  return normalizeDraft(parsed, defaults);
}

function parseRepairJson(raw, defaults = {}) {
  const cleaned = sanitizeJsonLike(raw);
  const parsed = safeJsonParse(cleaned);
  if (!parsed || typeof parsed !== 'object') return null;
  const guess = normalizeDraft(parsed, defaults);
  if (!guess.reasoningBullets.length && !guess.questions.length && !guess.proposedNextStep) return null;
  return guess;
}

function extractList(raw, key) {
  const r = new RegExp(`(?:\\[${key}\\]|${key}\\s*[:：])\\s*([\\s\\S]{0,400})`, 'i');
  const m = String(raw || '').match(r)?.[1] || '';
  if (!m) return [];
  return m
    .split(/\n|；|;|。|\.|、|-/)
    .map((x) => x.trim())
    .filter((x) => x && x.length > 2)
    .slice(0, 4);
}

function parseSemiStructured(raw, defaults = {}) {
  const s = String(raw || '');
  const replySpeaker = s.match(/(?:replyTo|speaker|回应对象)\s*[:：]\s*([^\n,，;；]{1,20})/i)?.[1] || defaults.speaker || '同学';
  const replyPoint = s.match(/(?:point|回应点|targetPoint)\s*[:：]\s*([^\n]{2,80})/i)?.[1] || defaults.point || '当前病例核心观点';
  const stance = s.match(/(?:stance|立场)\s*[:：]\s*([^\n]{2,60})/i)?.[1] || defaults.stance || '需优先处理高危矛盾';
  const reasoningBullets = extractList(s, 'Reasoning|推理|reasoningBullets');
  const questions = extractList(s, 'Question|问题|questions');
  const evidenceNeed = extractList(s, 'Evidence|证据|evidenceNeed');
  const proposedNextStep = s.match(/(?:next|下一步|proposedNextStep)\s*[:：]\s*([^\n]{2,120})/i)?.[1] || defaults.next || '';
  const safetyNote = s.match(/(?:safety|安全|safetyNote)\s*[:：]\s*([^\n]{2,120})/i)?.[1] || defaults.safetyNote || '';
  const obj = normalizeDraft({
    replyTo: { speaker: replySpeaker.trim(), point: replyPoint.trim() },
    stance: stance.trim(),
    reasoningBullets,
    questions,
    evidenceNeed,
    proposedNextStep: proposedNextStep.trim(),
    safetyNote: safetyNote.trim(),
  }, defaults);
  if (!obj.reasoningBullets.length && !obj.questions.length && !obj.proposedNextStep) return null;
  return obj;
}

function parseRoleDraft(raw, defaults = {}) {
  const modes = [];
  const strict = parseStrictJson(raw, defaults);
  modes.push('strict_json');
  if (strict) return { draft: strict, parseOk: true, source: 'model_json', parseModeTried: modes };
  const repaired = parseRepairJson(raw, defaults);
  modes.push('repair_json');
  if (repaired) return { draft: repaired, parseOk: true, source: 'model_repair', parseModeTried: modes };
  const semi = parseSemiStructured(raw, defaults);
  modes.push('semi_structured');
  if (semi) return { draft: semi, parseOk: true, source: 'model_semi_structured', parseModeTried: modes };
  return { draft: null, parseOk: false, source: 'none', parseModeTried: modes };
}

module.exports = {
  parseRoleDraft,
};
