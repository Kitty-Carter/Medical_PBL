function evaluateNoiseRedirect(ctx = {}) {
  const lowInfoStreak = Number(ctx.control?.lowInfoStreak || 0);
  const hasAgenda = !!ctx.control?.hasAgenda;
  const hit = lowInfoStreak >= 2 && hasAgenda;
  return {
    name: 'noise_redirect',
    matched: hit,
    decision: hit ? 'dispatch' : 'none',
    roleKey: 'ai_teacher',
    priority: hit ? 70 : 0,
    reason: hit ? 'redirect_from_noise' : '',
  };
}

module.exports = { evaluateNoiseRedirect };
