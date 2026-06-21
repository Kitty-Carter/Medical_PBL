function normalizeText(value) {
  return String(value || '').trim();
}

function isAiMessage(message) {
  if (!message) return false;

  const senderType = String(message.senderType || message.type || '').toLowerCase();
  const role = String(message.role || '').toLowerCase();
  const sender = String(message.sender || message.name || '').toLowerCase();

  return (
    senderType === 'ai' ||
    senderType === 'assistant' ||
    role === 'ai' ||
    role === 'assistant' ||
    role === 'teacher_ai' ||
    sender.includes('A教授') ||
    sender.includes('B同学') ||
    sender.includes('C同学') ||
    sender.includes('ai')
  );
}

function shouldSkipAi({ text, recentMessages = [] }) {
  const msg = normalizeText(text);

  if (!msg) {
    return { skip: true, reason: 'empty_message' };
  }

  if (/^(好的|好|收到|嗯|是的|同意|赞同|谢谢|ok|OK|1|。|\.)$/.test(msg)) {
    return { skip: true, reason: 'low_value_message' };
  }

  const lastTwo = Array.isArray(recentMessages) ? recentMessages.slice(-2) : [];
  const hasRecentAi = lastTwo.some(isAiMessage);

  if (hasRecentAi) {
    return { skip: true, reason: 'recent_ai_message' };
  }

  return { skip: false, reason: 'need_reply_check_passed' };
}

function pickAiRole({ text }) {
  const msg = normalizeText(text);

  if (/指南|文献|证据|研究|教材|机制|病理生理|病理/.test(msg)) {
    return 'C';
  }

  if (/我觉得|可能|是不是|不确定|有点|好像|疑惑|不太懂/.test(msg)) {
    return 'B';
  }

  if (/为什么|怎么|如何|鉴别|诊断|治疗|处理|下一步|考虑|区别|依据/.test(msg)) {
    return 'teacher';
  }

  return 'teacher';
}

function routeAiReply({ text, recentMessages = [] }) {
  const skipDecision = shouldSkipAi({ text, recentMessages });
  if (skipDecision.skip) {
    return { shouldReply: false, role: null, reason: skipDecision.reason };
  }

  const role = pickAiRole({ text });
  return { shouldReply: true, role, reason: 'matched_rule' };
}

module.exports = {
  routeAiReply,
  pickAiRole,
  shouldSkipAi,
  isAiMessage
};
