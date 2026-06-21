/**
 * PBL2 评分系统主模块
 * 提供统一的评分接口，兼容旧版本评分逻辑
 */

const { normalizeStudentScores } = require('./normalizeScores');
const { calculateMachineAttitudeScore } = require('./attitudeScore');
const { calculateRuleBasedThinkingScore } = require('./thinkingScore');
const { calculateAstrbotThinkingScore } = require('./astrbotThinkingEvaluator');

/**
 * 计算完整的机器评分（态度 + 思维）
 * @param {Object} student - 学生对象
 * @param {Object} room - 房间对象
 * @param {Object} options - 选项
 * @returns {Object} 评分结果
 */
function calculateMachineScores(student, room, options = {}) {
  const studentId = student.studentId;
  const messageCount = room.messageCounts?.get(studentId) || 0;
  
  // 1. 机器态度评分
  const attitudeScore = calculateMachineAttitudeScore(messageCount);
  
  // 2. 机器思维评分（第一阶段只使用本地规则）
  const studentMessages = (room.messages || []).filter(m => 
    m.sender?.id === studentId && m.type === 'text'
  );
  
  const thinkingScore = calculateRuleBasedThinkingScore(studentMessages, {
    studentName: student.name,
    roomCode: room.roomCode,
    caseText: options.caseText,
    ...options
  });
  
  // 第一阶段：不使用AstrBot，直接返回规则评分
  return {
    machine: {
      attitude: attitudeScore,
      thinking: thinkingScore
    }
  };
}

/**
 * 兼容旧版本的machineScore函数
 * @param {Object} input - 输入参数
 * @param {string} maybeName - 学生姓名
 * @returns {number} 机器评分（兼容版本）
 */
function legacyMachineScore(input, maybeName = '') {
  if (typeof input === 'number') {
    // 兼容旧的发言次数评分
    const attitudeScore = calculateMachineAttitudeScore(input);
    return attitudeScore.score;
  }
  
  // 兼容旧的metrics对象评分
  const metrics = input?.metrics || {};
  const count = metrics.count || 0;
  const attitudeScore = calculateMachineAttitudeScore(count);
  return attitudeScore.score;
}

module.exports = {
  normalizeStudentScores,
  calculateMachineAttitudeScore,
  calculateRuleBasedThinkingScore,
  calculateAstrbotThinkingScore,
  calculateMachineScores,
  legacyMachineScore
};
