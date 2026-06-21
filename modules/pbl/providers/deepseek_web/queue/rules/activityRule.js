function evaluateActivity(ctx = {}) {
  const informativeCountSinceAI = Number(ctx.control?.informativeCountSinceAI || 0);
  const senderRole = String(ctx.senderRole || 'student');
  const isInformative = !!ctx.isInformative;
  const should = isInformative && informativeCountSinceAI >= 1;
  const lastAiRole = String(ctx.control?.lastAiRole || '');

  let roleKey = 'ai_teacher';
  if (senderRole === 'student') {
    roleKey = lastAiRole === 'ai_student_B' ? 'ai_student_C' : 'ai_student_B';
  }

  return {
    name: 'activity_followup',
    matched: should,
    decision: should ? 'dispatch' : 'none',
    roleKey,
    priority: should ? 50 : 0,
    reason: should ? 'student_argument_followup' : '',
  };
}

module.exports = { evaluateActivity };
