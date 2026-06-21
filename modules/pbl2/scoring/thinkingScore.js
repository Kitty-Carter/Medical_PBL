/**
 * 机器思维评分模块（本地规则）
 * 基于发言内容的医学推理质量评分
 */

// 医学相关词汇库
const MEDICAL_KEYWORDS = new Set([
  // 基础医学概念
  '诊断', '鉴别诊断', '症状', '体征', '检查', '实验室检查', '影像', '治疗', '用药', 
  '病因', '病理', '风险因素', '病史', '主诉', '现病史', '既往史', '并发症', '预后', '随访',
  '感染', '炎症', '肿瘤', '免疫', '代谢', '循环', '呼吸', '消化', '神经', '心血管',
  
  // 具体疾病和症状
  '胸痛', '心悸', '气短', '呼吸困难', '发热', '咳嗽', '咳痰', '腹痛', '恶心', '呕吐',
  '腹泻', '便秘', '头痛', '头晕', '乏力', '水肿', '黄疸', '皮疹', '出血', '血栓',
  '高血压', '低血压', '心动过速', '心动过缓', '心律失常', '心力衰竭', '心肌梗死',
  '肺炎', '支气管炎', '哮喘', 'COPD', '肺栓塞', '胃炎', '胃溃疡', '肝炎', '肝硬化',
  '肾炎', '肾衰竭', '糖尿病', '甲状腺', '贫血', '白血病', '淋巴瘤',
  
  // 检查和检验
  '心电图', 'ECG', '胸片', 'CT', 'MRI', '超声', '内镜', '活检', '血常规', '尿常规',
  '生化', '肝功能', '肾功能', '电解质', '血糖', '血脂', '血气分析', '凝血功能',
  '心肌酶', '肌钙蛋白', 'D-二聚体', '血培养', '药敏试验',
  
  // 治疗相关
  '手术', '药物治疗', '抗生素', '止痛药', '降压药', '降糖药', '抗凝药', '溶栓',
  '输液', '氧疗', '呼吸机', '透析', '化疗', '放疗', '免疫治疗', '支持治疗',
  '保守治疗', '对症治疗', '病因治疗', '预防治疗', '康复治疗'
]);

// 证据使用关键词
const EVIDENCE_KEYWORDS = new Set([
  '根据', '提示', '支持', '不支持', '表现为', '结果显示', '患者有', '病史提示',
  '检查提示', '结合', '基于', '依据', '显示', '表明', '证实', '排除'
]);

// 逻辑推理关键词
const LOGIC_KEYWORDS = new Set([
  '因为', '所以', '因此', '提示', '考虑', '排除', '支持', '不支持', '如果', '那么',
  '可能', '需要进一步', '首先', '其次', '最后', '一方面', '另一方面', '虽然', '但是',
  '然而', '由于', '导致', '引起', '造成', '结果是', '推断', '判断', '分析'
]);

// 鉴别诊断关键词
const DIFFERENTIAL_KEYWORDS = new Set([
  '鉴别', '排除', '还需考虑', '可能是', '也可能', '与...鉴别', '支持', '反对',
  '不符合', '需要排除', '鉴别诊断', '可能性', '怀疑', '不能排除'
]);

// 问题意识关键词
const QUESTION_KEYWORDS = new Set([
  '还需要补充', '是否有', '有没有', '下一步需要', '需要了解', '要问', '缺少',
  '证据不足', '不确定', '需要确认', '应该检查', '需要进一步检查', '?', '？'
]);

// 临床决策关键词
const DECISION_KEYWORDS = new Set([
  '建议完善', '下一步', '应进行', '需要检查', '治疗上', '处理上', '随访', '复查',
  '评估', '观察', '监测', '调整', '改变', '开始', '停止', '继续', '加强'
]);

// 表达结构关键词
const STRUCTURE_KEYWORDS = new Set([
  '首先', '其次', '最后', '第一', '第二', '第三', '目前', '综上', '总结', '下一步',
  '总的来说', '综上所述', '总体来看', '整体而言', '初步判断', '最终结论'
]);

// 无效短句列表
const INVALID_SHORT_PHRASES = new Set([
  '好的', '嗯', '是', '不是', '我同意', '不知道', '收到', '？', '。', 'ok', 'yes',
  '明白', '了解', '清楚', '对的', '没错', '可以', '行', '好的', '嗯嗯'
]);

/**
 * 过滤无效发言
 * @param {Array} messages - 发言列表
 * @returns {Array} 有效发言列表
 */
function filterValidMessages(messages) {
  return messages.filter(msg => {
    const content = (msg.content || '').trim();
    if (!content) return false;
    
    // 过滤无效短句
    if (INVALID_SHORT_PHRASES.has(content)) return false;
    
    // 过滤过短的发言（少于5个字符）
    if (content.length < 5) return false;
    
    return true;
  });
}

/**
 * 检测重复发言
 * @param {Array} messages - 发言列表
 * @returns {Array} 去重后的发言
 */
function deduplicateMessages(messages) {
  const seen = new Set();
  const result = [];
  
  for (const msg of messages) {
    const content = (msg.content || '').trim().toLowerCase();
    if (!seen.has(content)) {
      seen.add(content);
      result.push(msg);
    }
  }
  
  return result;
}

/**
 * 计算单条发言的各维度分数
 * @param {string} content - 发言内容
 * @returns {Object} 各维度分数
 */
function calculateMessageDimensions(content) {
  const text = content.toLowerCase();
  // 中文不需要按空格分词，直接检查关键词是否在文本中
  const words = text;
  
  // 医学相关性 (15分)
  let medicalRelevance = 0;
  let medicalCount = 0;
  for (const keyword of MEDICAL_KEYWORDS) {
    if (words.includes(keyword)) medicalCount++;
  }
  if (medicalCount >= 5) medicalRelevance = 15;
  else if (medicalCount >= 3) medicalRelevance = 12;
  else if (medicalCount >= 2) medicalRelevance = 8;
  else if (medicalCount >= 1) medicalRelevance = 4;
  
  // 证据使用 (15分)
  let evidenceUse = 0;
  let evidenceCount = 0;
  for (const keyword of EVIDENCE_KEYWORDS) {
    if (words.includes(keyword)) evidenceCount++;
  }
  if (evidenceCount >= 3) evidenceUse = 15;
  else if (evidenceCount >= 2) evidenceUse = 10;
  else if (evidenceCount >= 1) evidenceUse = 5;
  
  // 逻辑推理 (20分)
  let reasoningLogic = 0;
  let logicCount = 0;
  for (const keyword of LOGIC_KEYWORDS) {
    if (words.includes(keyword)) logicCount++;
  }
  if (logicCount >= 4) reasoningLogic = 20;
  else if (logicCount >= 3) reasoningLogic = 15;
  else if (logicCount >= 2) reasoningLogic = 10;
  else if (logicCount >= 1) reasoningLogic = 5;
  
  // 鉴别诊断 (15分)
  let differentialDiagnosis = 0;
  let differentialCount = 0;
  for (const keyword of DIFFERENTIAL_KEYWORDS) {
    if (words.includes(keyword)) differentialCount++;
  }
  if (differentialCount >= 3) differentialDiagnosis = 15;
  else if (differentialCount >= 2) differentialDiagnosis = 10;
  else if (differentialCount >= 1) differentialDiagnosis = 5;
  
  // 问题意识 (10分)
  let questionAwareness = 0;
  let questionCount = 0;
  for (const keyword of QUESTION_KEYWORDS) {
    if (words.includes(keyword)) questionCount++;
  }
  if (questionCount >= 2) questionAwareness = 10;
  else if (questionCount >= 1) questionAwareness = 5;
  
  // 临床决策 (15分)
  let clinicalDecision = 0;
  let decisionCount = 0;
  for (const keyword of DECISION_KEYWORDS) {
    if (words.includes(keyword)) decisionCount++;
  }
  if (decisionCount >= 3) clinicalDecision = 15;
  else if (decisionCount >= 2) clinicalDecision = 10;
  else if (decisionCount >= 1) clinicalDecision = 5;
  
  // 表达结构 (10分)
  let expressionStructure = 0;
  let structureCount = 0;
  for (const keyword of STRUCTURE_KEYWORDS) {
    if (words.includes(keyword)) structureCount++;
  }
  if (structureCount >= 3) expressionStructure = 10;
  else if (structureCount >= 2) expressionStructure = 7;
  else if (structureCount >= 1) expressionStructure = 4;
  
  return {
    medicalRelevance,
    evidenceUse,
    reasoningLogic,
    differentialDiagnosis,
    questionAwareness,
    clinicalDecision,
    expressionStructure,
    total: medicalRelevance + evidenceUse + reasoningLogic + differentialDiagnosis + questionAwareness + clinicalDecision + expressionStructure
  };
}

/**
 * 检测关键词堆砌（降权处理）
 * @param {string} content - 发言内容
 * @param {Object} dimensions - 各维度分数
 * @returns {number} 降权系数
 */
function detectKeywordStacking(content, dimensions) {
  const text = content.toLowerCase();
  const words = text.split(/\s+/);
  
  // 检测是否只有关键词没有推理
  const hasLogicWords = words.some(word => LOGIC_KEYWORDS.has(word));
  const hasEvidenceWords = words.some(word => EVIDENCE_KEYWORDS.has(word));
  const medicalKeywordRatio = words.filter(word => MEDICAL_KEYWORDS.has(word)).length / words.length;
  
  // 如果医学关键词比例过高但缺乏逻辑和证据，可能是堆砌
  if (medicalKeywordRatio > 0.3 && !hasLogicWords && !hasEvidenceWords) {
    return 0.6; // 降权到60%
  }
  
  return 1.0; // 不降权
}

/**
 * 计算进步分
 * @param {Array} messages - 发言列表
 * @returns {number} 进步分 (0-15)
 */
function calculateProgressScore(messages) {
  if (messages.length < 2) return 0;
  
  const midIndex = Math.floor(messages.length / 2);
  const firstHalf = messages.slice(0, midIndex);
  const secondHalf = messages.slice(midIndex);
  
  const firstHalfAvg = firstHalf.reduce((sum, msg) => {
    const dims = calculateMessageDimensions(msg.content || '');
    return sum + dims.total;
  }, 0) / firstHalf.length;
  
  const secondHalfAvg = secondHalf.reduce((sum, msg) => {
    const dims = calculateMessageDimensions(msg.content || '');
    return sum + dims.total;
  }, 0) / secondHalf.length;
  
  const improvement = secondHalfAvg - firstHalfAvg;
  
  if (improvement > 10) return 15;
  else if (improvement > 5) return 10;
  else if (improvement > 0) return 8;
  else return 0;
}

/**
 * 生成评语
 * @param {Object} dimensions - 平均维度分数
 * @param {number} totalScore - 总分
 * @returns {string} 评语
 */
function generateComment(dimensions, totalScore) {
  const comments = [];
  
  if (dimensions.medicalRelevance >= 10) {
    comments.push('医学相关性较强');
  } else if (dimensions.medicalRelevance < 5) {
    comments.push('医学相关性较弱');
  }
  
  if (dimensions.evidenceUse >= 10) {
    comments.push('能引用病例证据');
  } else if (dimensions.evidenceUse < 5) {
    comments.push('缺少证据支持');
  }
  
  if (dimensions.reasoningLogic >= 15) {
    comments.push('逻辑推理清晰');
  } else if (dimensions.reasoningLogic < 8) {
    comments.push('逻辑推理不足');
  }
  
  if (dimensions.differentialDiagnosis >= 10) {
    comments.push('鉴别诊断考虑充分');
  } else if (dimensions.differentialDiagnosis < 5) {
    comments.push('鉴别诊断不足');
  }
  
  if (dimensions.clinicalDecision >= 10) {
    comments.push('能提出下一步计划');
  } else if (dimensions.clinicalDecision < 5) {
    comments.push('缺少临床决策');
  }
  
  if (comments.length === 0) {
    return '发言内容需要更多医学推理和分析。';
  }
  
  return comments.join('，') + '。';
}

/**
 * 计算基于规则的机器思维评分
 * @param {Array} messages - 学生发言列表
 * @param {Object} options - 选项
 * @returns {Object} 评分结果
 */
function calculateRuleBasedThinkingScore(messages, options = {}) {
  // 1. 预处理：过滤无效发言
  const validMessages = filterValidMessages(messages);
  const deduplicatedMessages = deduplicateMessages(validMessages);
  
  if (deduplicatedMessages.length === 0) {
    return {
      score: 0,
      source: 'rule',
      ruleScore: 0,
      aiScore: null,
      dimensions: {
        medicalRelevance: 0,
        evidenceUse: 0,
        reasoningLogic: 0,
        differentialDiagnosis: 0,
        questionAwareness: 0,
        clinicalDecision: 0,
        expressionStructure: 0
      },
      comment: '暂无有效医学推理发言',
      version: 'v2.0',
      updatedAt: new Date().toISOString()
    };
  }
  
  // 2. 计算每条发言的维度分数
  const messageScores = deduplicatedMessages.map(msg => {
    const content = msg.content || '';
    const dimensions = calculateMessageDimensions(content);
    
    // 检测关键词堆砌并降权
    const stackingPenalty = detectKeywordStacking(content, dimensions);
    
    return {
      content,
      dimensions: {
        medicalRelevance: Math.round(dimensions.medicalRelevance * stackingPenalty),
        evidenceUse: Math.round(dimensions.evidenceUse * stackingPenalty),
        reasoningLogic: Math.round(dimensions.reasoningLogic * stackingPenalty),
        differentialDiagnosis: Math.round(dimensions.differentialDiagnosis * stackingPenalty),
        questionAwareness: Math.round(dimensions.questionAwareness * stackingPenalty),
        clinicalDecision: Math.round(dimensions.clinicalDecision * stackingPenalty),
        expressionStructure: Math.round(dimensions.expressionStructure * stackingPenalty)
      },
      total: Math.round(dimensions.total * stackingPenalty)
    };
  });
  
  // 3. 聚合评分
  const topMessages = messageScores
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
  
  const topAvg = topMessages.reduce((sum, msg) => sum + msg.total, 0) / topMessages.length;
  const allAvg = messageScores.reduce((sum, msg) => sum + msg.total, 0) / messageScores.length;
  const progressScore = calculateProgressScore(deduplicatedMessages);
  
  // 最终分数：55%最高3条平均 + 30%全部平均 + 15%进步分
  const finalScore = Math.round(topAvg * 0.55 + allAvg * 0.3 + progressScore * 0.15);
  
  // 4. 计算平均维度分数
  const avgDimensions = {
    medicalRelevance: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.medicalRelevance, 0) / messageScores.length),
    evidenceUse: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.evidenceUse, 0) / messageScores.length),
    reasoningLogic: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.reasoningLogic, 0) / messageScores.length),
    differentialDiagnosis: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.differentialDiagnosis, 0) / messageScores.length),
    questionAwareness: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.questionAwareness, 0) / messageScores.length),
    clinicalDecision: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.clinicalDecision, 0) / messageScores.length),
    expressionStructure: Math.round(messageScores.reduce((sum, msg) => sum + msg.dimensions.expressionStructure, 0) / messageScores.length)
  };
  
  // 5. 生成评语
  const comment = generateComment(avgDimensions, finalScore);
  
  return {
    score: finalScore,
    source: 'rule',
    ruleScore: finalScore,
    aiScore: null,
    dimensions: avgDimensions,
    comment,
    version: 'v2.0',
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  calculateRuleBasedThinkingScore
};
