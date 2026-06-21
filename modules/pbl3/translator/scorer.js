/**
 * 信息量评分器（无需LLM）
 */

/**
 * 评估消息的信息量得分 (0-10)
 * @param {string} text - 消息文本
 * @param {Object} entities - 提取的实体
 * @returns {number} 0-10分
 */
function evaluateInfoScore(text, entities) {
  let score = 0;
  
  // 基础分：有实质内容
  if (text.length > 10) score += 1;
  if (text.length > 30) score += 1;
  
  // 数值类信息（生命体征、化验值）
  const numberPattern = /\d+(\.\d+)?/g;
  const numbers = text.match(numberPattern);
  if (numbers) {
    score += Math.min(numbers.length, 3); // 最多加3分
  }
  
  // 医学实体
  score += Math.min(entities.allKeywords.length, 3); // 最多加3分
  
  // 明确诊断或结论
  const conclusionPatterns = [
    '诊断', '考虑', '可能', '排除', '支持',
    '建议', '需要', '应该', '治疗', '处理'
  ];
  for (const pattern of conclusionPatterns) {
    if (text.includes(pattern)) {
      score += 0.5;
      break;
    }
  }
  
  // 低信息量词汇（扣分）
  const lowInfoPhrases = [
    '请开始', '继续', '你怎么看', '嗯', '好的', '明白',
    '收到', '知道了', '同意', '理解', '看看'
  ];
  for (const phrase of lowInfoPhrases) {
    if (text.includes(phrase) && text.length < 20) {
      score -= 2;
      break;
    }
  }
  
  // 限制范围
  return Math.max(0, Math.min(10, score));
}

module.exports = {
  evaluateInfoScore
};
