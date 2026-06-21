/**
 * Provider 路由 - 根据策略选择 longcat 或 web_relay
 */

const { pblConfig } = require('./config');

function resolveProvider({ role, stage, triggerReason, roomCode, providerHealth = {}, interruptionSignal = {} }) {
  if (!pblConfig.webRelayEnabled) return { primary: 'longcat', fallback: null, reason: 'webrelay_disabled' };
  const policy = pblConfig.providerPolicy || 'longcat_only';
  const relayHealthy = providerHealth.webRelayHealthy !== false;
  const interruptionHigh = Number(interruptionSignal.recentInterruptions || 0) >= 2;

  if (!relayHealthy) {
    return { primary: 'longcat', fallback: null, reason: 'webrelay_unhealthy' };
  }

  if (policy === 'longcat_only') return { primary: 'longcat', fallback: null, reason: 'policy_longcat_only' };
  if (policy === 'web_relay_only') return { primary: 'web_relay', fallback: 'longcat', reason: 'policy_webrelay_only' };

  if (policy === 'hybrid_prefer_web_relay') {
    if (role === 'teacher') return { primary: 'web_relay', fallback: 'longcat', reason: 'teacher_prefer_webrelay' };
    return { primary: interruptionHigh ? 'longcat' : 'web_relay', fallback: 'longcat', reason: 'hybrid_prefer_webrelay' };
  }
  if (policy === 'hybrid_prefer_longcat') {
    if (triggerReason === 'redirect_from_noise') return { primary: 'longcat', fallback: 'web_relay', reason: 'noise_short_turn' };
    return { primary: 'longcat', fallback: 'web_relay', reason: 'hybrid_prefer_longcat' };
  }
  if (policy === 'teacher_webrelay_students_longcat') {
    return role === 'teacher'
      ? { primary: 'web_relay', fallback: 'longcat', reason: 'teacher_webrelay' }
      : { primary: 'longcat', fallback: 'web_relay', reason: 'student_longcat' };
  }
  if (policy === 'teacher_longcat_students_webrelay') {
    return role === 'teacher'
      ? { primary: 'longcat', fallback: 'web_relay', reason: 'teacher_longcat' }
      : { primary: interruptionHigh ? 'longcat' : 'web_relay', fallback: 'longcat', reason: 'student_webrelay' };
  }

  return { primary: 'longcat', fallback: null, reason: 'default_longcat' };
}

module.exports = { resolveProvider };
