function looksLikeAiPaste(text = '') {
  const t = String(text || '').trim();
  if (t.length < 320) return false;
  const sectionLike = /(一、|二、|三、|总结|首先|其次|最后|综上|###|\d\.\s)/.test(t);
  const punctDense = ((t.match(/[；;。！？]/g) || []).length / Math.max(1, t.length)) > 0.03;
  return sectionLike || punctDense;
}

function evaluateAiPaste(ctx = {}) {
  const text = String(ctx.content || ctx.latestMessage || '');
  const hit = looksLikeAiPaste(text);
  return {
    name: 'ai_paste_suspected',
    matched: hit,
    decision: hit ? 'dispatch' : 'none',
    roleKey: 'ai_teacher',
    priority: hit ? 90 : 0,
    reason: hit ? 'ai_paste_suspected' : '',
  };
}

module.exports = {
  evaluateAiPaste,
  looksLikeAiPaste,
};
