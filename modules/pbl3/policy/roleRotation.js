/**
 * 角色轮换逻辑
 * 避免连续同角色输出（除red_flag/老师纠偏例外）
 */

/**
 * 选择下一个发言角色
 * @param {Object} state - 房间状态
 * @param {string} trigger - 触发类型
 * @returns {string} 'B' | 'C'
 */
function selectNextRole(state, trigger) {
  const { lastSpeakers = [], transcript = [] } = state;
  
  // 获取最近的AI发言者
  const recentAISpeakers = lastSpeakers.slice(-3);
  const lastAISpeaker = recentAISpeakers[recentAISpeakers.length - 1];
  
  // 策略1：根据内容选择
  if (trigger === 'student_claim') {
    const lastMessage = transcript[transcript.length - 1];
    if (lastMessage && lastMessage.text) {
      // 如果学生提出诊断/结论 -> B 质疑
      if (containsDiagnosis(lastMessage.text)) {
        return avoidRecentRole('B', recentAISpeakers);
      }
      
      // 如果学生提出检查/治疗 -> C 闭环
      if (containsTreatmentPlan(lastMessage.text)) {
        return avoidRecentRole('C', recentAISpeakers);
      }
    }
  }
  
  // 策略2：轮换原则
  if (lastAISpeaker === 'B') {
    return 'C';
  } else if (lastAISpeaker === 'C') {
    return 'B';
  }
  
  // 默认：B
  return 'B';
}

/**
 * 避免选择最近已发言的角色
 */
function avoidRecentRole(preferredRole, recentSpeakers) {
  const lastTwo = recentSpeakers.slice(-2);
  
  // 如果偏好角色在最近2次中已出现2次，切换
  const count = lastTwo.filter(r => r === preferredRole).length;
  if (count >= 2) {
    return preferredRole === 'B' ? 'C' : 'B';
  }
  
  return preferredRole;
}

/**
 * 检查是否包含诊断类内容
 */
function containsDiagnosis(text) {
  const diagnosisKeywords = [
    '诊断', '考虑', '可能是', '倾向于', '应该是',
    '符合', '支持', '不支持', '排除'
  ];
  
  return diagnosisKeywords.some(k => text.includes(k));
}

/**
 * 检查是否包含治疗计划
 */
function containsTreatmentPlan(text) {
  const treatmentKeywords = [
    '治疗', '处理', '用药', '手术', '观察',
    '建议', '需要', '应该', '检查', '监测'
  ];
  
  return treatmentKeywords.some(k => text.includes(k));
}

module.exports = {
  selectNextRole
};
