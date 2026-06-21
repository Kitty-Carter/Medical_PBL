/**
 * AstrBot 辅助机器思维评分模块 - 安全占位版本
 * 第二阶段再接入 AstrBot OpenAPI
 */

/**
 * 计算基于 AstrBot 的机器思维评分（占位版本）
 * @param {Array} messages - 学生发言列表
 * @param {Object} options - 选项
 * @returns {Promise<Object|null>} 评分结果（第一阶段返回null）
 */
async function calculateAstrbotThinkingScore(messages, options = {}) {
  // 第一阶段：安全占位，不调用真实API
  console.log(`[PBL2][Scoring] AstrBot thinking score disabled (placeholder) student=${options.studentName || 'unknown'}`);
  return null;
}

/**
 * 防抖的 AstrBot 评分调用（占位版本）
 */
class AstrbotScoringDebouncer {
  constructor() {
    this.pendingCalls = new Map();
    this.callTimes = new Map();
    this.debounceMs = 10000;
  }
  
  async debouncedCall(studentId, messages, options = {}) {
    // 第一阶段：直接返回null
    return null;
  }
  
  clearStudent(studentId) {
    this.pendingCalls.delete(studentId);
    this.callTimes.delete(studentId);
  }
  
  clearAll() {
    this.pendingCalls.clear();
    this.callTimes.clear();
  }
}

// 全局防抖实例
const globalDebouncer = new AstrbotScoringDebouncer();

module.exports = {
  calculateAstrbotThinkingScore,
  AstrbotScoringDebouncer,
  globalDebouncer
};
