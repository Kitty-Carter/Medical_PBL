const { evaluateRedFlag } = require('./rules/redFlagRule');
const { evaluateAiPaste } = require('./rules/aiPasteRule');
const { evaluateNoiseRedirect } = require('./rules/noiseRedirectRule');
const { evaluateActivity } = require('./rules/activityRule');

class WebRelayEvaluator {
  evaluate(ctx = {}) {
    const candidates = [
      evaluateRedFlag(ctx),
      evaluateAiPaste(ctx),
      evaluateNoiseRedirect(ctx),
      evaluateActivity(ctx),
    ].filter(Boolean);

    const matched = candidates.filter((c) => c.matched);
    if (!matched.length) {
      return {
        shouldDispatch: false,
        shouldDelay: !!ctx.isInformative,
        shouldDrop: !ctx.isInformative,
        triggerRuleMatched: 'none',
        reason: ctx.isInformative ? 'informative_no_rule' : 'low_information_skip',
        roleKey: '',
        priority: 0,
      };
    }

    const winner = matched.sort((a, b) => b.priority - a.priority)[0];
    return {
      shouldDispatch: winner.decision === 'dispatch',
      shouldDelay: false,
      shouldDrop: false,
      triggerRuleMatched: winner.name,
      reason: winner.reason || winner.name,
      roleKey: winner.roleKey || 'ai_teacher',
      priority: winner.priority || 0,
      aiPasteSuspected: winner.name === 'ai_paste_suspected',
    };
  }
}

module.exports = {
  WebRelayEvaluator,
};
