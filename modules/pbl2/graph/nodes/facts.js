// 节点2: update_state_facts - 结构化抽取临床事实并更新 snapshot
const { clinicalValueValidator } = require('./clinicalValueValidator');

/**
 * 从文本中抽取临床事实
 */
function extractFacts(text) {
  const facts = [];
  const timestamp = Date.now();

  // 生命体征提取
  const vitalPatterns = [
    { key: 'BP', regex: /血压[：:]\s*(\d{2,3}\/\d{2,3})\s*mmHg/i },
    { key: 'HR', regex: /心率[：:]\s*(\d{2,3})\s*(?:次\/分|bpm)/i },
    { key: 'RR', regex: /呼吸[：:]\s*(\d{1,2})\s*次\/分/i },
    { key: 'SpO2', regex: /血氧饱和度[：:]\s*(\d{1,3})%/i },
    { key: 'T', regex: /体温[：:]\s*([\d.]+)\s*°?C/i },
  ];

  // 实验室检查提取
  const labPatterns = [
    { key: 'Hb', regex: /血红蛋白[：:]\s*([\d.]+)\s*g\/L/i },
    { key: 'PLT', regex: /血小板[：:]\s*([\d.]+)\s*(?:×10⁹\/L|×10\^9\/L)/i },
    { key: 'PT', regex: /凝血酶原时间[：:]\s*([\d.]+)\s*(?:秒|s)/i },
    { key: 'APTT', regex: /活化部分凝血活酶时间[：:]\s*([\d.]+)\s*(?:秒|s)/i },
    { key: 'FIB', regex: /纤维蛋白原[：:]\s*([\d.]+)\s*g\/L/i },
    { key: 'D-dimer', regex: /D-二聚体[：:]\s*([\d.]+)\s*(?:mg\/L|μg\/mL)/i },
    { key: 'Lactate', regex: /乳酸[：:]\s*([\d.]+)\s*mmol\/L/i },
  ];

  // 液体相关
  const fluidPatterns = [
    { key: '尿量', regex: /尿量[：:]\s*([\d.]+)\s*ml/i },
    { key: '出血量', regex: /出血量[：:]\s*([\d.]+)\s*ml/i },
  ];

  [...vitalPatterns, ...labPatterns, ...fluidPatterns].forEach(({ key, regex }) => {
    const match = text.match(regex);
    if (match) {
      const value = match[1];
      // 简单校验
      if (clinicalValueValidator.isPlausible(key, value)) {
        facts.push({
          timestamp,
          category: getCategoryByKey(key),
          key,
          value,
          source: 'extracted',
        });
      }
    }
  });

  return facts;
}

function getCategoryByKey(key) {
  const vitalKeys = ['BP', 'HR', 'RR', 'SpO2', 'T'];
  const labKeys = ['Hb', 'PLT', 'PT', 'APTT', 'FIB', 'D-dimer', 'Lactate'];
  const fluidKeys = ['尿量', '出血量'];
  
  if (vitalKeys.includes(key)) return 'vital_sign';
  if (labKeys.includes(key)) return 'lab';
  if (fluidKeys.includes(key)) return 'fluid';
  return 'other';
}

/**
 * 更新 currentSnapshot
 */
function updateSnapshot(state, newFacts) {
  const snapshot = state.currentSnapshot;
  
  newFacts.forEach(fact => {
    if (fact.category === 'vital_sign') {
      snapshot.vitalSigns[fact.key] = fact.value;
    } else if (fact.category === 'lab') {
      snapshot.labs[fact.key] = fact.value;
    } else if (fact.category === 'fluid') {
      snapshot.fluids[fact.key] = fact.value;
    }
  });

  snapshot.updatedAt = Date.now();

  // 识别风险标志
  snapshot.riskFlags = identifyRiskFlags(snapshot);
}

function identifyRiskFlags(snapshot) {
  const flags = [];
  
  // 低血压
  const bp = snapshot.vitalSigns.BP;
  if (bp && bp.includes('/')) {
    const [sys] = bp.split('/').map(Number);
    if (sys < 90) flags.push('低血压');
  }

  // 低氧
  const spo2 = Number(snapshot.vitalSigns.SpO2);
  if (spo2 && spo2 < 90) flags.push('低氧血症');

  // 凝血异常
  const plt = Number(snapshot.labs.PLT);
  if (plt && plt < 50) flags.push('血小板减少');

  const fib = Number(snapshot.labs.FIB);
  if (fib && fib < 1.0) flags.push('低纤维蛋白原');

  return flags;
}

/**
 * 节点主函数
 */
function updateStateFacts(graphState) {
  const { state, ingestResult } = graphState;
  
  if (!ingestResult.latestMessage) {
    return { factsExtracted: [] };
  }

  const text = ingestResult.latestMessage.content || '';
  const facts = extractFacts(text);
  
  // 更新 factTimeline
  state.factTimeline.push(...facts);
  if (state.factTimeline.length > 50) {
    state.factTimeline = state.factTimeline.slice(-50);
  }

  // 更新 currentSnapshot
  updateSnapshot(state, facts);

  // 更新活动信号
  if (facts.length > 0) {
    state.activitySignals.informativeCount++;
    state.activitySignals.lastInformativeAt = Date.now();
  } else if (text.length < 20 || /好的|收到|明白/.test(text)) {
    state.activitySignals.noiseCount++;
  }

  state.activitySignals.aiPasteSuspected = ingestResult.aiPasteSuspected;

  return { factsExtracted: facts };
}

module.exports = { updateStateFacts };
