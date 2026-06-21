/**
 * 机器态度评分模块
 * 基于发言次数评价学生参与度
 */

/**
 * 计算机器态度评分
 * @param {number} messageCount - 发言次数
 * @returns {Object} 评分结果
 */
function calculateMachineAttitudeScore(messageCount) {
  const count = Math.max(0, Number(messageCount) || 0);
  
  let score = 0;
  let reason = "";
  
  // 根据发言次数计算分数
  if (count === 0) {
    score = 0;
    reason = "学生未发言，参与度为0";
  } else if (count === 1) {
    score = 40;
    reason = "学生发言1次，参与度较低";
  } else if (count === 2) {
    score = 60;
    reason = "学生发言2次，参与度一般";
  } else if (count === 3) {
    score = 75;
    reason = "学生发言3次，参与度较好";
  } else if (count === 4) {
    score = 85;
    reason = "学生发言4次，参与度较好";
  } else if (count >= 5) {
    score = 95;
    reason = `学生发言${count}次，参与度优秀`;
  }
  
  return {
    score,
    reason,
    version: "v2.0"
  };
}

/**
 * 兼容旧版本的简单评分函数
 * @param {number} messageCount - 发言次数
 * @returns {number} 评分分数
 */
function legacyAttitudeScore(messageCount) {
  const result = calculateMachineAttitudeScore(messageCount);
  return result.score;
}

module.exports = {
  calculateMachineAttitudeScore,
  legacyAttitudeScore
};
