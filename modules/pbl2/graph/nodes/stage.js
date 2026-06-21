// 节点3: detect_stage_and_loops - 更新议程阶段和开环问题
const { extractCaseEntities } = require('../../prompts/caseEntityExtractor');

function detectStageAndLoops(graphState) {
  const { state, room } = graphState;
  
  // 提取病例实体（用于阶段判断）
  const caseEntities = extractCaseEntities(room, state);
  
  // 简化的阶段推进逻辑（基于关键体征）
  const snapshot = state.currentSnapshot;
  const hasVitals = Object.keys(snapshot.vitalSigns).length >= 3;
  const hasLabs = Object.keys(snapshot.labs).length >= 2;
  const hasRiskFlags = snapshot.riskFlags.length > 0;
  
  // ===== P1改进：Stage识别纠偏 =====
  // 若病例包含明确的心力衰竭/呼吸衰竭特征 -> 直接进入"问题表述/初步鉴别"阶段
  const hasHFFeatures = 
    caseEntities.physicalExam.some(e => e.includes('湿啰音')) ||
    caseEntities.physicalExam.some(e => e.includes('水肿')) ||
    caseEntities.physicalExam.some(e => e.includes('杂音')) ||
    (caseEntities.vitalSigns.HR && parseInt(caseEntities.vitalSigns.HR) > 110);
  
  // 计数关键体征
  const keySignCount = [
    caseEntities.physicalExam.some(e => e.includes('湿啰音')),
    caseEntities.physicalExam.some(e => e.includes('水肿')),
    caseEntities.physicalExam.some(e => e.includes('杂音')),
    caseEntities.vitalSigns.HR && parseInt(caseEntities.vitalSigns.HR) > 100,
  ].filter(Boolean).length;
  
  // 若命中 >=2 项关键体征 -> 跳过澄清事实，直接进入问题表述/鉴别
  if (keySignCount >= 2 && state.agendaStage === '澄清事实') {
    console.log(`[Stage] 检测到${keySignCount}项关键体征，跳至"问题表述/初步鉴别+危险分层"`);
    state.agendaStage = '问题表述/初步鉴别';
  }
  
  // 原有阶段推进逻辑
  if (state.agendaStage === '澄清事实' && hasVitals && hasLabs) {
    state.agendaStage = '鉴别诊断';
  } else if (state.agendaStage === '鉴别诊断' && hasRiskFlags) {
    state.agendaStage = '检查与处置';
  }

  // 开环问题维护（简化版）
  const openLoops = state.openLoops || [];
  
  // 移除过期的开环问题（超过5分钟）
  const now = Date.now();
  state.openLoops = openLoops.filter(loop => now - loop.createdAt < 300000);

  // 检查是否有新的开环问题（示例：缺少关键检查）
  if (state.agendaStage === '检查与处置' && !snapshot.labs['PT']) {
    const exists = state.openLoops.some(l => l.question.includes('凝血功能'));
    if (!exists) {
      state.openLoops.push({
        question: '凝血功能（PT/APTT）是否已检查？',
        category: 'missing_lab',
        createdAt: now,
      });
    }
  }

  return {
    agendaStage: state.agendaStage,
    openLoopsCount: state.openLoops.length,
    caseEntities, // 返回，供后续使用
  };
}

module.exports = { detectStageAndLoops };
