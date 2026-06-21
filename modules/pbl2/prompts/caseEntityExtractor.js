// 病例实体提取器 - 从消息和 state 中提取关键医学实体
const ENTITY_PATTERNS = {
  // 症状/体征（允许的关键词）
  symptoms: [
    '气短', '呼吸困难', '端坐呼吸', '咳嗽', '咳痰', '胸痛', '胸闷',
    '心悸', '头晕', '晕厥', '发热', '畏寒', '乏力', '水肿',
    '少尿', '血尿', '泡沫尿', '恶心', '呕血', '便血', '腹泻',
    '湿啰音', '干啰音', '哮鸣音', '杂音', '奔马律',
    '凹陷性水肿', '非凹陷性水肿', '颈静脉怒张',
    '肺部', '心脏', '腹部', '四肢',
  ],
  
  // 体征/检查发现
  signs: [
    '心率', '血压', '呼吸', '体温', '血氧', 'SpO2', 'BP', 'HR', 'RR', 'T',
    '湿啰音', '干啰音', '杂音', '奔马律', '颈静脉怒张',
    '肝大', '脾大', '移动性浊音', '反跳痛', '肌紧张',
    'BNP', 'cTnI', 'CK-MB', 'D-二聚体',
    '心电图', '超声', 'X线', 'CT', 'MRI',
  ],
  
  // 禁止词（绝不应该出现的无关症状）
  forbidden: [
    '腹痛', '呕吐', '便血', '黄疸', '抽搐', '皮疹',
    '肠梗阻', '阑尾炎', '胰腺炎', '肠缺血',
    '腹膜炎', '腹水', '肝硬化',
  ],
};

/**
 * 从病例消息中提取实体
 */
function extractCaseEntities(room, state) {
  const messages = room.messages || [];
  const recentMessages = messages.slice(-20); // 最近20条
  
  const entities = {
    symptoms: new Set(),
    vitalSigns: {},
    labs: {},
    physicalExam: new Set(),
    quoteSnippets: [], // 可引用的原文片段
  };
  
  // 从消息中提取
  recentMessages.forEach(msg => {
    if (msg.type !== 'text' || !msg.content) return;
    const content = msg.content;
    
    // 提取症状
    ENTITY_PATTERNS.symptoms.forEach(symptom => {
      if (content.includes(symptom)) {
        entities.symptoms.add(symptom);
        
        // 提取包含该症状的句子作为 quoteSnippet
        const sentences = content.split(/[。！？；]/);
        sentences.forEach(sent => {
          if (sent.includes(symptom) && sent.length >= 8 && sent.length <= 40) {
            entities.quoteSnippets.push(sent.trim());
          }
        });
      }
    });
    
    // 提取生命体征数值
    extractVitalSigns(content, entities);
    
    // 提取体格检查
    ENTITY_PATTERNS.signs.forEach(sign => {
      if (content.includes(sign)) {
        entities.physicalExam.add(sign);
      }
    });
  });
  
  // 从 state.currentSnapshot 提取
  if (state.currentSnapshot) {
    const { vitalSigns, labs } = state.currentSnapshot;
    Object.assign(entities.vitalSigns, vitalSigns);
    Object.assign(entities.labs, labs);
  }
  
  // 转换为数组
  return {
    symptoms: Array.from(entities.symptoms),
    vitalSigns: entities.vitalSigns,
    labs: entities.labs,
    physicalExam: Array.from(entities.physicalExam),
    quoteSnippets: entities.quoteSnippets.slice(0, 10), // 最多10个
    allKeywords: [
      ...entities.symptoms,
      ...Object.keys(entities.vitalSigns).map(k => k + entities.vitalSigns[k]),
      ...entities.physicalExam,
    ],
  };
}

/**
 * 从文本中提取生命体征数值
 */
function extractVitalSigns(text, entities) {
  // 心率
  const hrMatch = text.match(/心率[：:]\s*(\d+)\s*[次\/]?分/);
  if (hrMatch) entities.vitalSigns.HR = hrMatch[1];
  
  // 血压
  const bpMatch = text.match(/血压[：:]\s*(\d+\/\d+)\s*mmHg/);
  if (bpMatch) entities.vitalSigns.BP = bpMatch[1];
  
  // 呼吸
  const rrMatch = text.match(/呼吸[：:]\s*(\d+)\s*[次\/]?分/);
  if (rrMatch) entities.vitalSigns.RR = rrMatch[1];
  
  // 体温
  const tMatch = text.match(/体温[：:]\s*([\d.]+)\s*℃/);
  if (tMatch) entities.vitalSigns.T = tMatch[1];
  
  // 血氧
  const spo2Match = text.match(/血氧[饱和度]*[：:]\s*(\d+)\s*%/);
  if (spo2Match) entities.vitalSigns.SpO2 = spo2Match[1];
}

/**
 * 从 extractedFacts 生成 allowlist（动态）
 */
function generateAllowlist(caseEntities) {
  const allowlist = new Set([
    ...caseEntities.symptoms,
    ...caseEntities.physicalExam,
    ...Object.keys(caseEntities.vitalSigns),
  ]);
  
  // 通用医学术语（总是允许）
  const generalTerms = [
    '病史', '体征', '检查', '诊断', '鉴别', '治疗', '处置',
    '复评', '监测', '观察', '升级', '降级',
    '证据', '矛盾', '漏洞', '闭环', '节点',
  ];
  
  generalTerms.forEach(term => allowlist.add(term));
  
  return Array.from(allowlist);
}

/**
 * 检查文本中是否包含禁止词
 */
function containsForbiddenWords(text, caseEntities) {
  const found = [];
  
  ENTITY_PATTERNS.forbidden.forEach(word => {
    // 只有当该词未出现在病例实体中时，才算禁止词
    if (text.includes(word) && !caseEntities.allKeywords.includes(word)) {
      found.push(word);
    }
  });
  
  return found;
}

/**
 * 选择最佳引用片段
 */
function selectQuoteSnippet(caseEntities, roleKey) {
  const snippets = caseEntities.quoteSnippets;
  if (snippets.length === 0) return null;
  
  // 优先选择包含异常体征的片段
  const abnormalSnippets = snippets.filter(s => 
    s.includes('湿啰音') || s.includes('杂音') || s.includes('水肿') || 
    s.includes('心率') || s.includes('血压')
  );
  
  if (abnormalSnippets.length > 0) {
    return abnormalSnippets[0];
  }
  
  return snippets[0];
}

module.exports = {
  extractCaseEntities,
  generateAllowlist,
  containsForbiddenWords,
  selectQuoteSnippet,
  ENTITY_PATTERNS,
};
