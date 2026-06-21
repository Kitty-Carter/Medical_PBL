// 节点: validate_segments - 加入 RelevanceGuard（强制病例相关性）
const { checkRelevance, generateRelevanceHints } = require('./relevanceGuard');

function validateSegments(graphState) {
  const { segments, turnPlan, state } = graphState;
  const errors = [];
  const warnings = [];
  const roleKey = turnPlan.roleKey;
  
  // ===== 硬门槛1: RelevanceGuard（病例相关性） =====
  const caseEntities = turnPlan.caseEntities || { allKeywords: [], quoteSnippets: [] };
  const relevanceCheck = checkRelevance(segments, caseEntities, turnPlan.roleKey);
  
  if (!relevanceCheck.passed) {
    errors.push('relevance_guard_failed');
    console.warn(`[RelevanceGuard] FAIL: ${relevanceCheck.reason}`);
    console.warn(`[RelevanceGuard] Details:`, JSON.stringify(relevanceCheck.details, null, 2));
  } else {
    console.log(`[RelevanceGuard] PASS: matched ${relevanceCheck.details.keywordCount} keywords`);
  }

  // ===== 硬门槛2: 角色段数与类型 =====
  const structureErrors = validateRoleStructure(segments, roleKey);
  errors.push(...structureErrors);

  // ===== 硬门槛3: Teacher 第一段必须包含引用锚点 =====
  if (segments.length > 0) {
    const firstSegment = segments[0].text;
    const quoteSnippet = turnPlan.quoteSnippet;
    
    let hasQuote = false;
    if (quoteSnippet && quoteSnippet.length >= 5) {
      // 检查第一段是否包含 quoteSnippet 的任何5字以上片段（降低要求）
      hasQuote = firstSegment.includes(quoteSnippet) || 
                 checkPartialQuote(firstSegment, quoteSnippet, 5);
    }
    
    if (roleKey === 'teacher' && !hasQuote && quoteSnippet) {
      errors.push('missing_quote_anchor');
      console.warn(`[QuoteAnchor] FAIL: 第一段缺少引用锚点`);
      console.warn(`[QuoteAnchor] Expected: "${quoteSnippet}"`);
      console.warn(`[QuoteAnchor] Got: "${firstSegment}"`);
    } else if (roleKey === 'teacher' && hasQuote) {
      console.log(`[QuoteAnchor] PASS: 第一段包含引用`);
    }
  }
  
  // ===== 校验4: 关键事实（降为警告） =====
  const hasKeyFact = segments.some(seg => {
    return turnPlan.keyFactCluster.some(fact => {
      const keywords = extractKeywords(fact);
      return keywords.some(kw => seg.text.includes(kw));
    });
  });
  if (!hasKeyFact) {
    warnings.push('missing_key_fact');
  }

  // ===== 校验5: 主矛盾（降为警告） =====
  const contradictionKeywords = extractKeywords(turnPlan.mainContradiction);
  const hasContradiction = segments.some(seg => 
    contradictionKeywords.some(kw => seg.text.includes(kw))
  );
  if (!hasContradiction && turnPlan.mainContradiction) {
    warnings.push('missing_contradiction');
  }

  // ===== 校验6: 必须包含问题（硬门槛） =====
  const hasQuestion = segments.some(seg => 
    seg.text.includes('？') || seg.text.includes('?') || 
    seg.text.includes('吗') || seg.text.includes('呢') ||
    seg.text.includes('怎么') || seg.text.includes('如何')
  );
  if (!hasQuestion && (roleKey === 'teacher' || roleKey === 'B')) {
    errors.push('missing_question');
  }

  // ===== 校验7: 套话检测（降为警告） =====
  const cooledPhrases = detectClichePhrases(segments, state, turnPlan.forbidPhrases);
  if (cooledPhrases.length > 2) {
    warnings.push('cliche_overuse');
  }

  // 综合判定
  const isValid = errors.length === 0;
  
  return {
    validationErrors: errors,
    validationWarnings: warnings,
    isValid,
    needsRewrite: !isValid, // 任何error都触发重写
    relevanceCheck: relevanceCheck.details,
    relevanceHints: isValid ? [] : generateRelevanceHints(caseEntities, turnPlan.roleKey),
  };
}

function validateRoleStructure(segments, roleKey) {
  const errors = [];
  const segmentTypes = new Set((segments || []).map((seg) => seg.type));
  const segmentCount = segments.length;

  if (roleKey === 'teacher') {
    if (segmentCount < 2 || segmentCount > 4) errors.push('teacher_segment_count_invalid');
    if (!segmentTypes.has('acknowledge')) errors.push('teacher_missing_acknowledge');
    if (!segmentTypes.has('priority')) errors.push('teacher_missing_priority');
    if (!segmentTypes.has('tasking')) errors.push('teacher_missing_tasking');
    if (!segmentTypes.has('question')) errors.push('teacher_missing_question_type');
  } else if (roleKey === 'B') {
    if (segmentCount < 1 || segmentCount > 3) errors.push('yu_segment_count_invalid');
    if (!segmentTypes.has('stance')) errors.push('yu_missing_stance');
    if (!segmentTypes.has('question')) errors.push('yu_missing_question_type');
  } else if (roleKey === 'C') {
    if (segmentCount < 1 || segmentCount > 3) errors.push('peng_segment_count_invalid');
    if (!segmentTypes.has('evidence_chain') && !segmentTypes.has('plan')) {
      errors.push('peng_missing_evidence_or_plan');
    }
  }

  return errors;
}

/**
 * 检查部分引用（至少minLength字连续匹配，默认5字）
 */
function checkPartialQuote(text, quote, minLength = 5) {
  if (!quote || quote.length < minLength) return false;
  
  // 提取引用中的minLength字以上片段
  for (let i = 0; i <= quote.length - minLength; i++) {
    const snippet = quote.substring(i, i + minLength);
    if (text.includes(snippet)) {
      return true;
    }
  }
  
  return false;
}

function extractKeywords(text) {
  // 提取中文词组（2-6字）
  const matches = text.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  return matches.slice(0, 5);
}

function detectClichePhrases(segments, state, forbidPhrases = []) {
  const currentText = segments.map(s => s.text).join('');
  const recentReplies = state.aiRecentReplies || [];
  const recentText = recentReplies.slice(-3).join('');

  const overused = [];
  
  // 检查 forbidPhrases
  forbidPhrases.forEach(phrase => {
    if (currentText.includes(phrase)) {
      overused.push(phrase);
    }
  });
  
  // 检查重复使用
  const commonCliches = [
    '证据链未闭合',
    '先稳定循环氧合',
    '需要进一步完善',
  ];
  
  commonCliches.forEach(phrase => {
    if (currentText.includes(phrase) && recentText.includes(phrase)) {
      overused.push(phrase);
    }
  });

  return overused;
}

module.exports = { validateSegments };
