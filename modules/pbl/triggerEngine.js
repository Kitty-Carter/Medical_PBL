const LOW_INFO_RE = /^(请开始|开始吧|大家怎么看|你怎么看|说说看法|继续|好的|嗯+|收到|ok|好的老师|开始讨论|请继续)[。！!？? ]*$/i;
const MEDICAL_ENTITY_RE = /(血压|心率|SpO2|体温|Hb|PLT|PT|APTT|纤维蛋白原|D-二聚体|乳酸|休克|DIC|脓毒症|胸痛|卒中|DKA|HHS|出血|感染|并发症|鉴别|检查|影像|CT|超声)/i;
const UNIT_RE = /(mmHg|g\/L|x10\^?9\/L|mmol\/L|%|ml|mL|次\/分|bpm)/i;

function isLowInformationMessage(text = '') {
  const t = String(text || '').trim();
  if (!t) return true;
  if (LOW_INFO_RE.test(t)) return true;
  if (t.length <= 6 && !/\d/.test(t)) return true;
  return false;
}

function scoreMessageInformation(text = '') {
  const t = String(text || '').trim();
  if (!t) return 0;
  if (isLowInformationMessage(t)) return -10;
  let score = 0;
  if (/\d/.test(t)) score += 2;
  if (UNIT_RE.test(t)) score += 2;
  if (MEDICAL_ENTITY_RE.test(t)) score += 4;
  if (/[?？]/.test(t)) score += 0.6;
  if (/(倾向|考虑|排除|不考虑|更像|建议|优先)/.test(t)) score += 1.8;
  return score;
}

function isInformativeMessage(text = '') {
  return scoreMessageInformation(text) >= 2.5;
}

function shouldTeacherOpening(room) {
  const texts = (room.messages || []).filter((m) => m.type === 'text');
  if (!texts.length) return false;
  const first = texts[0];
  const firstIsCase = scoreMessageInformation(first.content || '') >= 3.5;
  const last = texts[texts.length - 1];
  const lastLow = isLowInformationMessage(last.content || '');
  const hasAgenda = !!room.pblControl?.hasAgenda;
  return firstIsCase && lastLow && !hasAgenda;
}

function ensureControl(room) {
  if (!room.pblControl) {
    room.pblControl = {
      informativeCountSinceTeacher: 0,
      informativeCountSinceAI: 0,
      lowInfoStreak: 0,
      lastTeacherAt: 0,
      lastAiRole: '',
      hasAgenda: false,
      openingDone: false,
    };
  }
  return room.pblControl;
}

function decideTriggers({ room, senderRole, content }) {
  const c = ensureControl(room);
  const informative = isInformativeMessage(content);
  c.lowInfoStreak = informative ? 0 : (c.lowInfoStreak || 0) + 1;
  if (senderRole === 'teacher') {
    c.hasAgenda = true;
  }
  if (informative) {
    c.informativeCountSinceAI += 1;
    c.informativeCountSinceTeacher += 1;
  }

  if (shouldTeacherOpening(room) && !c.openingDone) {
    c.openingDone = true;
    c.hasAgenda = true;
    c.informativeCountSinceTeacher = 0;
    return { shouldEmitAI: true, preferredRole: 'teacher', reason: 'meeting_opening_mode', informative };
  }

  // Teacher intervention: critical red flags or frequent moderate informative turns
  const critical = /(血压\s*\d{2,3}\/\d{2,3}|乳酸|意识|持续出血|SpO2|休克|DIC)/i.test(String(content || ''));
  if (informative && (critical || c.informativeCountSinceTeacher >= 2)) {
    c.informativeCountSinceTeacher = 0;
    c.lastTeacherAt = Date.now();
    c.lastAiRole = 'teacher';
    return { shouldEmitAI: true, preferredRole: 'teacher', reason: critical ? 'red_flag_detected' : 'teacher_focus_refresh', informative };
  }

  // Student AI: respond quickly to keep discussion active.
  if (informative && senderRole === 'student' && c.informativeCountSinceAI >= 1) {
    c.informativeCountSinceAI = 0;
    const evidenceLike = /(证据|化验|检查|并发症|红旗|监测|趋势|复评)/.test(String(content || ''));
    const pick = evidenceLike
      ? (c.lastAiRole === 'ai_student_C' ? 'ai_student_B' : 'ai_student_C')
      : (c.lastAiRole === 'ai_student_B' ? 'ai_student_C' : 'ai_student_B');
    c.lastAiRole = pick;
    return { shouldEmitAI: true, preferredRole: pick, reason: 'student_argument_followup', informative };
  }

  if (!informative && c.lowInfoStreak >= 2 && c.hasAgenda) {
    c.lowInfoStreak = 0;
    c.lastAiRole = 'teacher';
    return { shouldEmitAI: true, preferredRole: 'teacher', reason: 'redirect_from_noise', informative };
  }

  return { shouldEmitAI: false, preferredRole: '', reason: informative ? 'informative_no_trigger' : 'low_information_skip', informative };
}

module.exports = {
  isLowInformationMessage,
  scoreMessageInformation,
  isInformativeMessage,
  decideTriggers,
};
