/**
 * 引用片段提取器
 * 从原文中选择最适合作为引用锚点的片段（8-20字）
 */

/**
 * 提取引用片段
 * @param {string} text - 原文
 * @param {Object} entities - 已提取的实体
 * @returns {string} 8-20字的引用片段
 */
function extractQuoteSnippet(text, entities) {
  // 优先级1：含生命体征的句子片段
  if (entities.vitalSigns && Object.keys(entities.vitalSigns).length > 0) {
    const snippet = findSnippetWithPattern(text, Object.keys(entities.vitalSigns)[0]);
    if (snippet) return snippet;
  }
  
  // 优先级2：含症状的句子片段
  if (entities.symptoms && entities.symptoms.length > 0) {
    const snippet = findSnippetWithPattern(text, entities.symptoms[0]);
    if (snippet) return snippet;
  }
  
  // 优先级3：含体征的句子片段
  if (entities.physicalExam && entities.physicalExam.length > 0) {
    const snippet = findSnippetWithPattern(text, entities.physicalExam[0]);
    if (snippet) return snippet;
  }
  
  // 优先级4：主诉类句子
  const chiefComplaintPattern = /主诉[：:].{8,25}/;
  const match = text.match(chiefComplaintPattern);
  if (match) {
    return match[0].substring(0, 20);
  }
  
  // 优先级5：前20字
  return text.substring(0, Math.min(20, text.length)).trim();
}

/**
 * 查找包含特定模式的片段
 */
function findSnippetWithPattern(text, keyword) {
  const index = text.indexOf(keyword);
  if (index === -1) return null;
  
  // 向前向后各取一些字符
  const start = Math.max(0, index - 5);
  const end = Math.min(text.length, index + keyword.length + 10);
  
  let snippet = text.substring(start, end).trim();
  
  // 调整到合适长度
  if (snippet.length < 8) {
    // 太短，向后扩展
    const extendEnd = Math.min(text.length, end + 12);
    snippet = text.substring(start, extendEnd).trim();
  } else if (snippet.length > 20) {
    // 太长，截断
    snippet = snippet.substring(0, 20);
  }
  
  // 清理
  snippet = snippet.replace(/^[，。、；：！？\s]+/, '');
  snippet = snippet.replace(/[，。、；：！？\s]+$/, '');
  
  return snippet.length >= 8 && snippet.length <= 25 ? snippet : null;
}

/**
 * 从候选列表中选择最佳引用片段
 */
function selectBestQuoteSnippet(candidates, entities) {
  if (!candidates || candidates.length === 0) {
    return '';
  }
  
  // 评分规则
  const scored = candidates.map(snippet => {
    let score = 0;
    
    // 长度适中加分
    if (snippet.length >= 10 && snippet.length <= 18) {
      score += 2;
    }
    
    // 包含实体加分
    const allKeywords = [
      ...Object.keys(entities.vitalSigns || {}),
      ...(entities.symptoms || []),
      ...(entities.physicalExam || [])
    ];
    
    for (const keyword of allKeywords) {
      if (snippet.includes(keyword)) {
        score += 3;
      }
    }
    
    // 包含数值加分
    if (/\d+/.test(snippet)) {
      score += 1;
    }
    
    return { snippet, score };
  });
  
  // 按分数排序
  scored.sort((a, b) => b.score - a.score);
  
  return scored[0].snippet;
}

module.exports = {
  extractQuoteSnippet,
  selectBestQuoteSnippet
};
