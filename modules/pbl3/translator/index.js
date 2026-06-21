/**
 * Translator：消息翻译官（规则优先、轻量、无LLM）
 * 职责：把原始聊天消息翻译成结构化 Event
 */

const { evaluateInfoScore } = require('./scorer');
const { detectEventType, detectRedFlag, detectAIPaste } = require('./rules');
const { extractEntities } = require('./entityExtractor');
const { extractQuoteSnippet } = require('./quoteExtractor');

/**
 * 主翻译函数
 * @param {Object} room - 房间状态
 * @param {Object} msg - 原始消息 { speaker, text, ts }
 * @returns {Object} Event
 */
function translateMessage(room, msg) {
  const { speaker, text, ts } = msg;
  
  // 1. 提取结构化实体
  const entities = extractEntities(text);
  
  // 2. 信息量评分
  const infoScore = evaluateInfoScore(text, entities);
  
  // 3. 事件类型判定
  const eventType = detectEventType(room, msg, infoScore, entities);
  
  // 4. 特殊标记
  const flags = {
    aiPasteSuspected: detectAIPaste(text),
    redFlagDetected: detectRedFlag(entities),
    isLowInfo: infoScore < 3
  };
  
  // 5. 提取可引用片段
  const quoteSnippetCandidate = extractQuoteSnippet(text, entities);
  
  // 6. 判定角色
  const senderRole = determineSenderRole(speaker, room);
  
  const event = {
    type: eventType,
    senderRole,
    senderName: speaker,
    text,
    ts: ts || Date.now(),
    infoScore,
    entities,
    flags,
    quoteSnippetCandidate
  };
  
  console.log(`[Translator] ${eventType} | infoScore=${infoScore} | entities=${entities.allKeywords.length} | flags=${JSON.stringify(flags)}`);
  
  return event;
}

/**
 * 判定发言者角色
 */
function determineSenderRole(speaker, room) {
  // AI角色
  if (['A教授', 'teacher', 'B同学', 'B', 'C同学', 'C'].includes(speaker)) {
    return 'ai';
  }
  
  // 学生
  return 'student';
}

module.exports = {
  translateMessage
};
