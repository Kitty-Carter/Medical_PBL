function evaluateRedFlag(ctx = {}) {
  const text = String(ctx.content || ctx.latestMessage || '');
  const hit = /(低血压|血压\s*\d{2,3}\/\d{2,3}|SpO2|乳酸|意识|休克|DIC|持续出血|胸痛|夹层|肺栓塞)/i.test(text);
  return {
    name: 'red_flag_detected',
    matched: hit,
    decision: hit ? 'dispatch' : 'none',
    roleKey: 'ai_teacher',
    priority: hit ? 100 : 0,
    reason: hit ? 'red_flag_detected' : '',
  };
}

module.exports = { evaluateRedFlag };
