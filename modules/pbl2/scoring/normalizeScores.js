/**
 * 评分数据结构标准化模块
 * 确保所有学生对象都有完整的scores结构，兼容旧数据
 */

/**
 * 标准化学生评分数据结构
 * @param {Object} student - 学生对象
 * @returns {Object} 标准化后的学生对象
 */
function normalizeStudentScores(student) {
  if (!student) return student;
  
  // 如果已经有完整的scores结构，直接返回
  if (student.scores && 
      student.scores.machine && 
      student.scores.machine.attitude && 
      student.scores.machine.thinking &&
      student.scores.teacher && 
      student.scores.teacher.attitude && 
      student.scores.teacher.thinking) {
    return student;
  }
  
  // 初始化scores结构
  const scores = {
    machine: {
      attitude: {
        score: 0,
        reason: "",
        version: "v2.0"
      },
      thinking: {
        score: 0,
        source: "rule",
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
        comment: "",
        version: "v2.0",
        updatedAt: null
      }
    },
    teacher: {
      attitude: {
        score: 100,
        edited: false,
        updatedAt: null
      },
      thinking: {
        score: 100,
        edited: false,
        updatedAt: null
      }
    }
  };
  
  // 兼容旧数据：machineScore -> machine.attitude.score
  if (student.machineScore !== undefined && typeof student.machineScore === 'number') {
    scores.machine.attitude.score = student.machineScore;
    scores.machine.attitude.reason = `兼容旧数据：原机器评分 ${student.machineScore}`;
  }
  
  // 兼容旧数据：teacherScore -> teacher.attitude.score
  if (student.teacherScore !== undefined && typeof student.teacherScore === 'number') {
    scores.teacher.attitude.score = student.teacherScore;
    scores.teacher.attitude.edited = true; // 假设旧数据都是教师手动设置的
    scores.teacher.attitude.updatedAt = new Date().toISOString();
  }
  
  // 如果没有teacher评分，保持默认值
  if (student.teacherScore === undefined) {
    scores.teacher.attitude.edited = false;
    scores.teacher.thinking.edited = false;
  }
  
  // 赋值到学生对象
  student.scores = scores;
  
  return student;
}

/**
 * 标准化学生列表的评分数据
 * @param {Array} students - 学生列表
 * @returns {Array} 标准化后的学生列表
 */
function normalizeStudentListScores(students) {
  if (!Array.isArray(students)) return students;
  return students.map(student => normalizeStudentScores(student));
}

/**
 * 从scores结构中提取兼容的旧字段
 * @param {Object} student - 标准化后的学生对象
 * @returns {Object} 兼容旧版本的数据
 */
function extractLegacyScores(student) {
  const legacy = {};
  
  if (student.scores) {
    // 提取machineScore（使用attitude评分）
    if (student.scores.machine && student.scores.machine.attitude) {
      legacy.machineScore = student.scores.machine.attitude.score;
    }
    
    // 提取teacherScore（使用attitude评分）
    if (student.scores.teacher && student.scores.teacher.attitude) {
      legacy.teacherScore = student.scores.teacher.attitude.score;
    }
  }
  
  return legacy;
}

/**
 * 计算最终成绩（兼容旧版本算法）
 * @param {Object} student - 标准化后的学生对象
 * @returns {number} 最终成绩
 */
function calculateFinalScore(student) {
  if (!student.scores) return 0;
  
  const machineScore = student.scores.machine?.attitude?.score || 0;
  const teacherScore = student.scores.teacher?.attitude?.score || 100;
  
  // 保持原有的权重：机器评分90% + 教师评分10%
  return Math.round(machineScore * 0.9 + teacherScore * 0.1);
}

module.exports = {
  normalizeStudentScores,
  normalizeStudentListScores,
  extractLegacyScores,
  calculateFinalScore
};
