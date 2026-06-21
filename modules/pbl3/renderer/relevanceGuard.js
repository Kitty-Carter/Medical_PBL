/**
 * RelevanceGuard：对题硬门槛
 * 检查：≥2个keyEntities、无禁词、有引用锚点
 */

const { containsForbiddenWords, generateAllowlist } = require('../translator/entityExtractor');

/**
 * 检查相关性
 * @param {Array} segments - 生成的段落
 * @param {Object} policy - 策略决策
 * @param {Object} event - 事件
 * @returns {Object} { passed, reason, details }
 */
function checkRelevance(segments, policy, event) {
  const { keyEntities = [] } = policy;
  const { entities } = event;
  
  const fullText = segments.map(s => s.text).join(' ');
  
  // 1. 检查关键实体匹配（≥2个）
  let matchedCount = 0;
  const matchedEntities = [];
  
  for (const entity of keyEntities) {
    if (fullText.includes(entity) || fullText.includes(entity.split(':')[0])) {
      matchedCount++;
      matchedEntities.push(entity);
    }
  }
  
  if (matchedCount < 2) {
    return {
      passed: false,
      reason: `关键实体不足（${matchedCount}/2）`,
      details: { matchedCount, matchedEntities, keyEntities }
    };
  }
  
  // 2. 检查禁止词
  const allowlist = generateAllowlist(entities);
  const forbiddenCheck = containsForbiddenWords(fullText, allowlist);
  
  if (forbiddenCheck.forbidden) {
    return {
      passed: false,
      reason: `包含禁止词：${forbiddenCheck.word}`,
      details: { forbiddenWord: forbiddenCheck.word }
    };
  }
  
  // 3. 检查第一段引用锚点
  if (segments.length > 0) {
    const firstSegment = segments[0].text;
    const quoteSnippet = policy.quoteSnippet;
    
    if (quoteSnippet && quoteSnippet.length >= 5) {
      const hasQuote = checkPartialQuote(firstSegment, quoteSnippet, 5);
      
      if (!hasQuote) {
        return {
          passed: false,
          reason: '第一段缺少引用锚点',
          details: { expected: quoteSnippet, got: firstSegment }
        };
      }
    }
  }
  
  // 全部通过
  return {
    passed: true,
    reason: 'OK',
    details: { matchedCount, matchedEntities }
  };
}

/**
 * 检查部分引用（至少minLength字连续匹配）
 */
function checkPartialQuote(text, quote, minLength = 5) {
  if (!quote || quote.length < minLength) return false;
  
  for (let i = 0; i <= quote.length - minLength; i++) {
    const snippet = quote.substring(i, i + minLength);
    if (text.includes(snippet)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 生成相关性提示（用于重写）
 */
function generateRelevanceHints(policy, event) {
  return `重写要求：
1. 必须包含这些关键词：${policy.keyEntities.join('、')}
2. 第一段必须引用："${policy.quoteSnippet}"
3. 禁止提及：腹痛、呕吐、便血、发热、咳嗽等病例中不存在的症状`;
}

module.exports = {
  checkRelevance,
  generateRelevanceHints
};
