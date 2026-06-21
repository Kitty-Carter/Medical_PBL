/**
 * Debounce & Cooldown 管理
 * 防刷屏：debounce（合并）+ cooldown（冷却）
 */

// 房间级别的冷却记录
const roomCooldowns = new Map();

/**
 * 检查是否应该合并消息（debounce）
 * @param {Object} room
 * @returns {boolean}
 */
function shouldDebounce(room) {
  const { state = {} } = room;
  const { transcript = [] } = state;
  
  // 最近2-6秒内有多个informative事件
  const now = Date.now();
  const recentWindow = 6000; // 6秒
  
  const recentMessages = transcript.filter(msg => {
    return (now - msg.ts) < recentWindow && msg.infoScore >= 5;
  });
  
  return recentMessages.length >= 2;
}

/**
 * 检查是否在冷却期
 * @param {Object} room
 * @returns {Object} { shouldWait, remainingMs }
 */
function shouldCooldown(room) {
  const roomId = room.roomId;
  const cooldownData = roomCooldowns.get(roomId);
  
  if (!cooldownData) {
    return { shouldWait: false, remainingMs: 0 };
  }
  
  const { lastResponseTs, cooldownMs } = cooldownData;
  const now = Date.now();
  const elapsed = now - lastResponseTs;
  
  if (elapsed < cooldownMs) {
    return {
      shouldWait: true,
      remainingMs: cooldownMs - elapsed
    };
  }
  
  return { shouldWait: false, remainingMs: 0 };
}

/**
 * 记录本次回应，启动冷却
 * @param {string} roomId
 * @param {number} cooldownMs
 */
function recordResponse(roomId, cooldownMs = 4000) {
  roomCooldowns.set(roomId, {
    lastResponseTs: Date.now(),
    cooldownMs
  });
  
  console.log(`[Cooldown] 房间${roomId}进入冷却期：${cooldownMs}ms`);
}

/**
 * 清除冷却（用于红旗等紧急事件）
 * @param {string} roomId
 */
function clearCooldown(roomId) {
  roomCooldowns.delete(roomId);
  console.log(`[Cooldown] 清除房间${roomId}冷却`);
}

/**
 * 清理过期的冷却记录
 */
function cleanupExpiredCooldowns() {
  const now = Date.now();
  const maxAge = 300000; // 5分钟
  
  for (const [roomId, data] of roomCooldowns.entries()) {
    if (now - data.lastResponseTs > maxAge) {
      roomCooldowns.delete(roomId);
    }
  }
}

// 定期清理
setInterval(cleanupExpiredCooldowns, 60000); // 每分钟清理一次

module.exports = {
  shouldDebounce,
  shouldCooldown,
  recordResponse,
  clearCooldown
};
