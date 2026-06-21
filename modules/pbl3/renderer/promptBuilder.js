/**
 * Prompt 构建器
 * 组装完整的 messages 数组
 */

const { systemPrompt, outputProtocol, roleCards } = require('./roleCards');
const { buildContextPack } = require('./contextPackBuilder');

/**
 * 构建完整 messages
 */
function buildMessages(room, policy, event) {
  const { roleKey } = policy;
  
  // 1. 获取角色卡
  const roleCard = roleCards[roleKey] || roleCards.teacher;
  
  // 2. 构建上下文
  const contextPack = buildContextPack(room, event, policy);
  
  // 3. 组装 system message（合并）
  const systemMessage = `${systemPrompt}

${outputProtocol}

【本轮角色】
${roleCard}`;
  
  // 4. 组装 user message
  const userMessage = contextPack;
  
  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage }
  ];
  
  console.log(`[PromptBuilder] system=${systemMessage.length}字, user=${userMessage.length}字`);
  
  return messages;
}

module.exports = {
  buildMessages
};
