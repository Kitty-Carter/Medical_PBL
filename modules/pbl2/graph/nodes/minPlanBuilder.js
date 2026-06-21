// 确定性最小计划生成器 - 槽位化、病例绑定、强相关性
const { extractCaseEntities, selectQuoteSnippet } = require('../../prompts/caseEntityExtractor');

function deterministicMinPlan(state, room, roleKey, triggerReason) {
  // 1. 提取病例实体（核心）
  const caseEntities = extractCaseEntities(room, state);
  
  // 2. 选择引用锚点
  const quoteSnippet = selectQuoteSnippet(caseEntities, roleKey);
  
  // 3. 提取关键事实（必须来自 caseEntities）
  const keyFactCluster = extractKeyFactsFromEntities(caseEntities, state);
  
  // 4. 生成主矛盾（基于 caseEntities）
  const mainContradiction = generateContradictionFromEntities(caseEntities, state);
  
  // 5. 生成下一步动作（槽位化）
  const nextActions = generateActionsFromEntities(caseEntities, roleKey, state);
  
  // 6. 生成分叉问题（病例相关）
  const questionOrBranch = generateQuestionFromEntities(caseEntities, roleKey, state);
  
  // 7. 禁止词表（必须）
  const forbidPhrases = [
    '证据链未闭合',
    '先稳定循环氧合',
    '需要进一步完善',
    '我们来看看',
    '这个问题很重要',
    '目前处于澄清事实阶段', // 新增：禁止元话术
    '让我们继续讨论',
  ];
  
  return {
    roleKey,
    speechActs: getSpeechActsByRole(roleKey),
    caseEntities, // 必须包含，用于 validator
    quoteSnippet, // 第一段必须使用
    keyFactCluster,
    mainContradiction,
    nextActions,
    questionOrBranch,
    tone: getToneByRole(roleKey),
    segmentSpec: {
      count: roleKey === 'teacher' ? 3 : 2,
      maxCharsPerSegment: 180,
    },
    forbidPhrases,
  };
}

/**
 * 从病例实体提取关键事实（槽位化）
 */
function extractKeyFactsFromEntities(caseEntities, state) {
  const facts = [];
  
  // 优先：生命体征异常
  const { vitalSigns } = caseEntities;
  if (vitalSigns.HR && parseInt(vitalSigns.HR) > 100) {
    facts.push(`心率${vitalSigns.HR}次/分`);
  }
  if (vitalSigns.BP) {
    facts.push(`血压${vitalSigns.BP}mmHg`);
  }
  if (vitalSigns.SpO2 && parseInt(vitalSigns.SpO2) < 95) {
    facts.push(`血氧${vitalSigns.SpO2}%`);
  }
  
  // 体格检查阳性体征
  const keyPhysicalExam = ['湿啰音', '杂音', '水肿', '颈静脉怒张', '奔马律'];
  caseEntities.physicalExam.forEach(exam => {
    if (keyPhysicalExam.some(key => exam.includes(key))) {
      facts.push(exam);
    }
  });
  
  // 症状
  const keySym = ['气短', '呼吸困难', '心悸', '咳嗽', '端坐呼吸'];
  caseEntities.symptoms.forEach(symptom => {
    if (keySym.includes(symptom) && facts.length < 6) {
      facts.push(symptom);
    }
  });
  
  // 如果没有提取到任何事实 -> 返回缺失信息提示（不是占位示例！）
  if (facts.length === 0) {
    return ['当前缺少关键体征数据', '需要补充病史和体格检查'];
  }
  
  return facts.slice(0, 6);
}

/**
 * 从病例实体生成主矛盾（槽位化）
 */
function generateContradictionFromEntities(caseEntities, state) {
  const { vitalSigns, physicalExam, symptoms } = caseEntities;
  
  // 规则1：心力衰竭特征（湿啰音+水肿+心动过速）
  const hasHFFeatures = 
    physicalExam.some(e => e.includes('湿啰音')) &&
    (physicalExam.some(e => e.includes('水肿')) || symptoms.includes('气短'));
  
  if (hasHFFeatures && vitalSigns.HR && parseInt(vitalSigns.HR) > 100) {
    return '心功能不全与容量负荷过重需立即干预';
  }
  
  // 规则2：呼吸衰竭风险
  if (symptoms.includes('呼吸困难') && vitalSigns.SpO2 && parseInt(vitalSigns.SpO2) < 90) {
    return '低氧血症与呼吸衰竭风险需紧急处理';
  }
  
  // 规则3：循环不稳定
  if (vitalSigns.BP && (vitalSigns.BP.startsWith('9') || vitalSigns.BP.startsWith('8'))) {
    return '血流动力学不稳定与组织灌注不足需优先纠正';
  }
  
  // 默认：基于阶段
  if (state.agendaStage === '鉴别诊断') {
    return '多个可能诊断与证据权重分配需明确';
  }
  
  // 缺少关键信息时
  return '关键临床信息不完整影响诊疗决策';
}

/**
 * 从病例实体生成动作（槽位化）
 */
function generateActionsFromEntities(caseEntities, roleKey, state) {
  const { vitalSigns, physicalExam, symptoms } = caseEntities;
  const actions = [];
  
  // 基于心力衰竭特征
  if (physicalExam.some(e => e.includes('湿啰音'))) {
    actions.push('完善BNP/NT-proBNP评估心功能');
    actions.push('心脏超声明确射血分数');
  }
  
  // 基于低氧
  if (vitalSigns.SpO2 && parseInt(vitalSigns.SpO2) < 93) {
    actions.push('吸氧提升SpO2至94%以上');
    actions.push('复查血气分析');
  }
  
  // 基于心动过速
  if (vitalSigns.HR && parseInt(vitalSigns.HR) > 110) {
    actions.push('评估心动过速原因（贫血/甲亢/心衰）');
  }
  
  // 如果没有具体动作，给槽位化的通用指导（必须与 roleKey 绑定）
  if (actions.length === 0) {
    if (roleKey === 'teacher') {
      actions.push('B同学找出当前推理的漏洞');
      actions.push('C同学补充证据链节点');
    } else if (roleKey === 'B') {
      actions.push('质疑诊断的排除逻辑');
      actions.push('追问阈值和鉴别标准');
    } else {
      actions.push('补充关键检查结果');
      actions.push('明确复评时间点');
    }
  }
  
  return actions.slice(0, 3);
}

/**
 * 从病例实体生成问题（槽位化+分叉）
 */
function generateQuestionFromEntities(caseEntities, roleKey, state) {
  const { vitalSigns, physicalExam } = caseEntities;
  
  if (roleKey === 'teacher') {
    // 必须A/B分叉
    if (physicalExam.some(e => e.includes('湿啰音')) && vitalSigns.HR) {
      return `若BNP明显升高，A）先利尿降负荷还是B）先强心改善收缩？哪个更紧急？`;
    }
    
    if (vitalSigns.SpO2) {
      return `若胸片示肺水肿，A）左心衰还是B）ARDS？鉴别点是什么？`;
    }
    
    return '当前主要矛盾是什么？B同学先找漏洞，C同学再给证据链';
  } else if (roleKey === 'B') {
    return '用什么证据排除更危险的病因？阈值标准是什么？';
  } else {
    return '现在缺哪个关键检查来闭环？复评触发点是什么？';
  }
}

function getSpeechActsByRole(roleKey) {
  const acts = {
    teacher: ['acknowledge', 'priority_correction', 'tasking', 'branch_question'],
    B: ['stance', 'contradiction_attack', 'challenge_question'],
    C: ['evidence_chain', 'operational_next_step'],
  };
  return acts[roleKey] || acts.teacher;
}

function getToneByRole(roleKey) {
  const tones = {
    teacher: '温和权威、承接分工、A/B追问',
    B: '尖锐理性、抓漏洞、要阈值',
    C: '稳健证据链、补节点、给时间点',
  };
  return tones[roleKey] || tones.teacher;
}

module.exports = { deterministicMinPlan };
