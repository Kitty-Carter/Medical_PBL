/**
 * 事件类型判定规则
 */

/**
 * 检测事件类型
 * @returns {string} case_posted | student_claim | evidence_update | red_flag | ai_paste | noise | teacher_prompt | room_close
 */
function detectEventType(room, msg, infoScore, entities) {
  const { text } = msg;
  const { transcript = [] } = room.state || {};
  
  // 1. 房间关闭
  if (text.includes('[房间关闭]') || text.includes('[close]')) {
    return 'room_close';
  }
  
  // 2. 红旗事件（优先级最高）
  if (detectRedFlag(entities)) {
    return 'red_flag';
  }
  
  // 3. AI长文粘贴（优先级高于新病例）
  if (detectAIPaste(text)) {
    return 'ai_paste';
  }
  
  // 4. 新病例发布
  if (isNewCasePost(text, transcript)) {
    return 'case_posted';
  }
  
  // 5. 学生明确结论/诊断
  if (isStudentClaim(text, entities)) {
    return 'student_claim';
  }
  
  // 6. 证据更新（补充化验、检查结果）
  if (isEvidenceUpdate(text, entities, infoScore)) {
    return 'evidence_update';
  }
  
  // 7. 教师提示
  if (isTeacherPrompt(msg.speaker)) {
    return 'teacher_prompt';
  }
  
  // 8. 噪音（低信息量）
  if (infoScore < 3) {
    return 'noise';
  }
  
  // 默认：学生发言
  return 'student_claim';
}

/**
 * 检测是否为新病例发布
 */
function isNewCasePost(text, transcript) {
  // 病例特征词
  const caseKeywords = ['患者', '主诉', '现病史', '既往史', '体格检查', '辅助检查'];
  const keywordCount = caseKeywords.filter(k => text.includes(k)).length;
  
  // 长度 + 关键词
  if (text.length > 100 && keywordCount >= 2) {
    return true;
  }
  
  // 房间首条实质性消息
  if (transcript.length <= 2 && text.length > 50) {
    return true;
  }
  
  return false;
}

/**
 * 检测是否为学生明确结论
 */
function isStudentClaim(text, entities) {
  const claimPatterns = [
    '诊断', '考虑', '可能是', '倾向于', '应该是',
    '排除', '支持', '不支持', '符合', '建议',
    '治疗', '处理', '用药', '手术', '观察'
  ];
  
  for (const pattern of claimPatterns) {
    if (text.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 检测是否为证据更新
 */
function isEvidenceUpdate(text, entities, infoScore) {
  // 有新化验值 + 信息量高
  if (entities.labs && Object.keys(entities.labs).length > 0 && infoScore >= 5) {
    return true;
  }
  
  // 有新生命体征
  if (entities.vitalSigns && Object.keys(entities.vitalSigns).length > 0) {
    return true;
  }
  
  return false;
}

/**
 * 检测是否为教师人工提示
 */
function isTeacherPrompt(speaker) {
  // 如果是真人教师（非AI）
  return speaker && speaker.includes('教师') && !speaker.includes('A教授');
}

/**
 * 检测红旗事件（危险信号）
 */
function detectRedFlag(entities) {
  const { vitalSigns, labs, symptoms } = entities;
  
  // 生命体征危险
  if (vitalSigns) {
    if (vitalSigns.SBP && parseInt(vitalSigns.SBP) < 90) return true;
    if (vitalSigns.SpO2 && parseInt(vitalSigns.SpO2) < 92) return true;
    if (vitalSigns.HR && (parseInt(vitalSigns.HR) > 140 || parseInt(vitalSigns.HR) < 40)) return true;
  }
  
  // 化验危险
  if (labs) {
    if (labs.Hb && parseInt(labs.Hb) < 60) return true;
    if (labs.PLT && parseInt(labs.PLT) < 30) return true;
    if (labs.K && parseFloat(labs.K) > 6.0) return true;
    if (labs['乳酸'] && parseFloat(labs['乳酸']) > 4.0) return true;
  }
  
  // 症状危险
  const dangerSymptoms = [
    '意识障碍', '昏迷', '休克', '呼吸衰竭',
    '持续出血', '大出血', '心跳骤停', '呼吸停止'
  ];
  if (symptoms) {
    for (const danger of dangerSymptoms) {
      if (symptoms.includes(danger)) return true;
    }
  }
  
  return false;
}

/**
 * 检测AI长文粘贴
 */
function detectAIPaste(text) {
  // 长度阈值
  if (text.length < 150) return false; // 降低阈值
  
  // 结构特征：分段标题
  const structurePatterns = [
    /【.*?】/g,
    /^\d+\./gm,
    /^一、|^二、|^三、/gm,
    /\n\n/g
  ];
  
  let structureScore = 0;
  for (const pattern of structurePatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length >= 2) { // 降低阈值
      structureScore++;
    }
  }
  
  // 总结腔
  const summaryPhrases = [
    '综上所述', '总结', '综合分析', '整体评估',
    '建议如下', '处理流程', '诊疗计划', '鉴别诊断'
  ];
  for (const phrase of summaryPhrases) {
    if (text.includes(phrase)) {
      structureScore++;
      break;
    }
  }
  
  return structureScore >= 2;
}

module.exports = {
  detectEventType,
  detectRedFlag,
  detectAIPaste
};
