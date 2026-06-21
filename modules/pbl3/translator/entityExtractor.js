/**
 * 结构化实体提取器
 * 从文本中提取：生命体征、化验值、症状、体征
 */

// 实体匹配模式
const ENTITY_PATTERNS = {
  // 生命体征
  vitalSigns: {
    BP: /血压[：:]?\s*(\d+\/\d+)\s*mmHg/i,
    SBP: /收缩压[：:]?\s*(\d+)/i,
    DBP: /舒张压[：:]?\s*(\d+)/i,
    HR: /心率[：:]?\s*(\d+)\s*次/i,
    RR: /呼吸[：:]?\s*(\d+)\s*次/i,
    SpO2: /[氧血]?氧饱和度[：:]?\s*(\d+)%?/i,
    T: /体温[：:]?\s*(\d+\.?\d*)\s*[℃°C]/i
  },
  
  // 化验值
  labs: {
    Hb: /血红蛋白|Hb[：:]?\s*(\d+)/i,
    WBC: /白细胞|WBC[：:]?\s*(\d+\.?\d*)/i,
    PLT: /血小板|PLT[：:]?\s*(\d+)/i,
    PT: /凝血酶原时间|PT[：:]?\s*(\d+\.?\d*)/i,
    APTT: /APTT|活化部分凝血活酶时间[：:]?\s*(\d+\.?\d*)/i,
    FIB: /纤维蛋白原|FIB[：:]?\s*(\d+\.?\d*)/i,
    D二聚体: /D-?二聚体|D-dimer[：:]?\s*(\d+\.?\d*)/i,
    乳酸: /乳酸|Lac[：:]?\s*(\d+\.?\d*)/i,
    Cr: /肌酐|Cr[：:]?\s*(\d+)/i,
    BUN: /尿素氮|BUN[：:]?\s*(\d+\.?\d*)/i,
    K: /[血钾]钾[：:]?\s*(\d+\.?\d*)/i,
    Na: /[血钠]钠[：:]?\s*(\d+\.?\d*)/i,
    BNP: /BNP|脑钠肽[：:]?\s*(\d+)/i
  },
  
  // 症状
  symptoms: [
    '气短', '呼吸困难', '心悸', '胸痛', '胸闷',
    '咳嗽', '咳痰', '咯血', '发热', '畏寒',
    '乏力', '头晕', '头痛', '恶心', '呕吐',
    '腹痛', '腹泻', '便血', '黑便', '水肿',
    '夜间咳嗽', '端坐呼吸', '阵发性夜间呼吸困难'
  ],
  
  // 体征
  physicalExam: [
    '湿啰音', '干啰音', '哮鸣音', '呼吸音减弱', '呼吸音消失',
    '杂音', '心音低钝', '心音遥远', '奔马律',
    '凹陷性水肿', '非凹陷性水肿', '颈静脉怒张',
    '肝大', '脾大', '腹水征', '移动性浊音',
    '压痛', '反跳痛', '肌紧张', '腹膜刺激征'
  ],
  
  // 禁止词（病例中不存在但容易被AI提及）
  forbiddenWords: [
    '发热', '咳嗽', '咳痰', '腹痛', '腹泻', '便血',
    '头痛', '头晕', '恶心', '呕吐', '黑便'
  ]
};

/**
 * 提取所有实体
 */
function extractEntities(text) {
  const entities = {
    vitalSigns: {},
    labs: {},
    symptoms: [],
    physicalExam: [],
    allKeywords: [],
    quoteSnippets: []
  };
  
  // 1. 提取生命体征
  for (const [key, pattern] of Object.entries(ENTITY_PATTERNS.vitalSigns)) {
    const match = text.match(pattern);
    if (match) {
      entities.vitalSigns[key] = match[1];
      entities.allKeywords.push(`${key}:${match[1]}`);
    }
  }
  
  // 特殊处理：从"血压80/50"这种格式提取SBP
  const bpMatch = text.match(/血压.*?(\d+)\/(\d+)/);
  if (bpMatch) {
    entities.vitalSigns.SBP = bpMatch[1];
    entities.vitalSigns.DBP = bpMatch[2];
  }
  
  // 2. 提取化验值
  for (const [key, pattern] of Object.entries(ENTITY_PATTERNS.labs)) {
    const match = text.match(pattern);
    if (match) {
      entities.labs[key] = match[1];
      entities.allKeywords.push(`${key}:${match[1]}`);
    }
  }
  
  // 3. 提取症状
  for (const symptom of ENTITY_PATTERNS.symptoms) {
    if (text.includes(symptom)) {
      entities.symptoms.push(symptom);
      entities.allKeywords.push(symptom);
    }
  }
  
  // 4. 提取体征
  for (const sign of ENTITY_PATTERNS.physicalExam) {
    if (text.includes(sign)) {
      entities.physicalExam.push(sign);
      entities.allKeywords.push(sign);
    }
  }
  
  // 5. 提取可引用片段（含实体的8-20字）
  entities.quoteSnippets = extractQuoteSnippets(text, entities);
  
  return entities;
}

/**
 * 提取可引用片段
 */
function extractQuoteSnippets(text, entities) {
  const snippets = [];
  
  // 找到含实体的句子片段
  const allKeywords = [
    ...Object.keys(entities.vitalSigns),
    ...Object.keys(entities.labs),
    ...entities.symptoms,
    ...entities.physicalExam
  ];
  
  for (const keyword of allKeywords) {
    const regex = new RegExp(`.{0,10}${keyword}.{0,10}`, 'g');
    const matches = text.match(regex);
    if (matches) {
      for (const match of matches) {
        const cleaned = match.trim();
        if (cleaned.length >= 8 && cleaned.length <= 25) {
          snippets.push(cleaned);
        }
      }
    }
  }
  
  return snippets.slice(0, 5); // 最多5个
}

/**
 * 检查是否包含禁止词
 */
function containsForbiddenWords(text, allowlist = []) {
  for (const word of ENTITY_PATTERNS.forbiddenWords) {
    if (text.includes(word) && !allowlist.includes(word)) {
      return { forbidden: true, word };
    }
  }
  return { forbidden: false };
}

/**
 * 生成动态允许列表（从当前病例实体）
 */
function generateAllowlist(entities) {
  return [
    ...entities.symptoms,
    ...entities.physicalExam
  ];
}

module.exports = {
  extractEntities,
  containsForbiddenWords,
  generateAllowlist,
  ENTITY_PATTERNS
};
