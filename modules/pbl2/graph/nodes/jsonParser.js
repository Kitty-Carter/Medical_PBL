// 稳健 JSON 解析器 - 多策略提取
function robustParseJSON(content, tag = 'unknown') {
  const parseModeTried = [];
  let result = null;

  // 策略1: 严格 JSON 解析
  try {
    result = JSON.parse(content);
    parseModeTried.push('strict_json');
    return { success: true, data: result, parseModeTried };
  } catch (e) {
    // 继续尝试其他策略
  }

  // 策略2: 去除代码块和前后缀
  try {
    let cleaned = content.trim();
    
    // 去除 markdown 代码块
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
    
    // 去除前后空白和注释
    cleaned = cleaned.replace(/^[\s\r\n]+/, '');
    cleaned = cleaned.replace(/[\s\r\n]+$/, '');
    
    result = JSON.parse(cleaned);
    parseModeTried.push('remove_codeblock');
    return { success: true, data: result, parseModeTried };
  } catch (e) {
    // 继续
  }

  // 策略3: 提取最大 JSON 对象段
  try {
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const extracted = content.substring(firstBrace, lastBrace + 1);
      result = JSON.parse(extracted);
      parseModeTried.push('extract_braces');
      return { success: true, data: result, parseModeTried };
    }
  } catch (e) {
    // 继续
  }

  // 策略4: 修复常见 JSON 错误
  try {
    let repaired = content;
    
    // 找到 JSON 对象
    const match = repaired.match(/\{[\s\S]*\}/);
    if (match) {
      repaired = match[0];
      
      // 修复尾逗号
      repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
      
      // 修复单引号为双引号（简化版，可能误伤字符串内容）
      repaired = repaired.replace(/'/g, '"');
      
      // 修复中文引号
      repaired = repaired.replace(/[""]/g, '"');
      repaired = repaired.replace(/['']/g, "'");
      
      result = JSON.parse(repaired);
      parseModeTried.push('repair_json');
      return { success: true, data: result, parseModeTried };
    }
  } catch (e) {
    // 继续
  }

  // 策略5: 半结构化字段提取（降级方案）
  try {
    const semiStructured = extractSemiStructured(content);
    if (semiStructured) {
      parseModeTried.push('semi_structured');
      return { success: true, data: semiStructured, parseModeTried, isFallback: true };
    }
  } catch (e) {
    console.error(`[robustParseJSON] 半结构化提取失败:`, e.message);
  }

  // 全部失败
  parseModeTried.push('all_failed');
  console.error(`[robustParseJSON][${tag}] 所有解析策略失败，内容前500字:`, content.slice(0, 500));
  
  return { success: false, data: null, parseModeTried, rawContent: content.slice(0, 500) };
}

/**
 * 半结构化字段提取（从文本中提取关键字段）
 */
function extractSemiStructured(content) {
  const extracted = {};

  // 提取 roleKey
  const roleKeyMatch = content.match(/"roleKey"\s*:\s*"(teacher|B|C)"/);
  if (roleKeyMatch) extracted.roleKey = roleKeyMatch[1];

  // 提取 questionOrBranch
  const questionMatch = content.match(/"questionOrBranch"\s*:\s*"([^"]+)"/);
  if (questionMatch) extracted.questionOrBranch = questionMatch[1];

  // 提取 mainContradiction
  const contradictionMatch = content.match(/"mainContradiction"\s*:\s*"([^"]+)"/);
  if (contradictionMatch) extracted.mainContradiction = contradictionMatch[1];

  // 提取 keyFactCluster (数组)
  const factsMatch = content.match(/"keyFactCluster"\s*:\s*\[([\s\S]*?)\]/);
  if (factsMatch) {
    const factItems = factsMatch[1].match(/"([^"]+)"/g);
    if (factItems) {
      extracted.keyFactCluster = factItems.map(f => f.replace(/"/g, ''));
    }
  }

  // 提取 nextActions (数组)
  const actionsMatch = content.match(/"nextActions"\s*:\s*\[([\s\S]*?)\]/);
  if (actionsMatch) {
    const actionItems = actionsMatch[1].match(/"([^"]+)"/g);
    if (actionItems) {
      extracted.nextActions = actionItems.map(a => a.replace(/"/g, ''));
    }
  }

  // 如果提取到足够字段，认为成功
  if (extracted.roleKey && extracted.questionOrBranch) {
    // 填充默认值
    extracted.speechActs = extracted.speechActs || ['acknowledge', 'question'];
    extracted.keyFactCluster = extracted.keyFactCluster || ['当前病情进展'];
    extracted.mainContradiction = extracted.mainContradiction || '需明确诊断方向';
    extracted.nextActions = extracted.nextActions || ['继续观察'];
    extracted.tone = '专业';
    extracted.segmentSpec = { count: 2, maxCharsPerSegment: 180 };
    extracted.replyTarget = null;
    
    return extracted;
  }

  return null;
}

module.exports = { robustParseJSON };
