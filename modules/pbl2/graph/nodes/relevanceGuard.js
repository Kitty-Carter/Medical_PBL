// 相关性守卫 - 强制病例相关性硬门槛
const { containsForbiddenWords } = require('../../prompts/caseEntityExtractor');

/**
 * 检查输出的相关性（硬门槛）
 * @returns { passed: boolean, reason: string, details: object }
 */
function checkRelevance(segments, caseEntities, roleKey) {
  const fullText = segments.map(s => s.text).join('');
  
  const checks = {
    hasCaseKeywords: false,
    keywordCount: 0,
    matchedKeywords: [],
    forbiddenWords: [],
    hasQuoteAnchor: false,
    quoteAnchorInFirstSegment: false,
  };
  
  // 检查1：输出必须包含 >=2 个来自 caseEntities 的关键词
  const allKeywords = caseEntities.allKeywords || [];
  allKeywords.forEach(keyword => {
    if (fullText.includes(keyword)) {
      checks.keywordCount++;
      checks.matchedKeywords.push(keyword);
    }
  });
  
  checks.hasCaseKeywords = checks.keywordCount >= 2;
  
  // 检查2：不得包含禁止词（未在病例中出现的症状）
  checks.forbiddenWords = containsForbiddenWords(fullText, caseEntities);
  
  // 检查3：第一段必须包含引用锚点（从 quoteSnippets 来）
  if (segments.length > 0) {
    const firstSegment = segments[0].text;
    const quoteSnippets = caseEntities.quoteSnippets || [];
    
    // 检查是否包含任一引用片段的部分（至少8字）
    checks.hasQuoteAnchor = quoteSnippets.some(snippet => {
      // 提取片段中的关键部分（8-20字）
      const keywords = extractQuoteKeywords(snippet);
      return keywords.some(kw => firstSegment.includes(kw));
    });
    
    checks.quoteAnchorInFirstSegment = checks.hasQuoteAnchor;
  }
  
  const needsQuoteAnchor = roleKey === 'teacher';

  // 综合判定
  const passed = 
    checks.hasCaseKeywords && 
    checks.forbiddenWords.length === 0 &&
    (!needsQuoteAnchor || checks.hasQuoteAnchor);
  
  let reason = '';
  if (!checks.hasCaseKeywords) {
    reason = `缺少病例关键词（需>=2个，实际${checks.keywordCount}个）`;
  } else if (checks.forbiddenWords.length > 0) {
    reason = `包含无关症状词：${checks.forbiddenWords.join(', ')}`;
  } else if (needsQuoteAnchor && !checks.hasQuoteAnchor) {
    reason = '第一段缺少引用锚点（需引用病例原文8-20字）';
  }
  
  return {
    passed,
    reason: passed ? 'passed' : reason,
    details: checks,
  };
}

/**
 * 从引用片段中提取关键词（8-20字）
 */
function extractQuoteKeywords(snippet) {
  const keywords = [];
  
  // 提取包含数值的短语（如"心率115次/分"）
  const numMatches = snippet.match(/[\u4e00-\u9fa5]+\d+[\u4e00-\u9fa5\/]*/g);
  if (numMatches) {
    keywords.push(...numMatches);
  }
  
  // 提取医学术语短语（如"双肺底湿啰音"）
  const medMatches = snippet.match(/[\u4e00-\u9fa5]{4,12}/g);
  if (medMatches) {
    keywords.push(...medMatches.filter(m => m.length >= 8 && m.length <= 20));
  }
  
  return keywords;
}

/**
 * 相关性增强建议（用于重写时的提示）
 */
function generateRelevanceHints(caseEntities, roleKey) {
  const hints = [];
  
  // 提示可用的关键词
  if (caseEntities.allKeywords.length > 0) {
    const topKeywords = caseEntities.allKeywords.slice(0, 5).join('、');
    hints.push(`必须使用病例关键词：${topKeywords}`);
  }
  
  // 提示可用的引用片段
  if (roleKey === 'teacher' && caseEntities.quoteSnippets.length > 0) {
    hints.push(`第一段必须引用原文，例如："${caseEntities.quoteSnippets[0]}"`);
  }
  
  // 提示禁止词
  hints.push('禁止使用未在病例中出现的症状（如腹痛、呕吐等）');
  
  return hints;
}

module.exports = {
  checkRelevance,
  generateRelevanceHints,
};
