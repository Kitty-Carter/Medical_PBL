/**
 * Chunk Scheduler：分段发送调度器
 * 职责：段间300~900ms jitter + 用户中断丢弃后续段
 */

// 房间级别的中断标记
const roomInterrupts = new Map();

/**
 * 调度并发送分段消息
 * @param {Object} room - 房间对象
 * @param {Array} segments - 段落数组
 * @param {Object} policy - 策略决策
 * @returns {Promise<Object>} 发送结果
 */
async function scheduleChunks(room, segments, policy) {
  const roomId = room.roomId;
  const chunks = [];
  let interrupted = false;
  
  // 清除之前的中断标记
  roomInterrupts.delete(roomId);
  
  console.log(`[ChunkScheduler] 开始发送${segments.length}个段落，房间${roomId}`);
  
  for (let i = 0; i < segments.length; i++) {
    // 检查是否被中断
    if (roomInterrupts.get(roomId)) {
      console.log(`[ChunkScheduler] 检测到用户中断，丢弃剩余${segments.length - i}个段落`);
      interrupted = true;
      break;
    }
    
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    
    // 构建chunk
    const chunk = {
      index: i + 1,
      total: segments.length,
      type: segment.type,
      text: segment.text,
      isLast,
      debugMeta: isLast ? buildDebugMeta(policy, segments) : null
    };
    
    chunks.push(chunk);
    
    // 模拟发送（实际在server.js中通过socket发送）
    console.log(`[ChunkScheduler] [${i + 1}/${segments.length}] ${segment.type}: ${segment.text.substring(0, 30)}...`);
    
    // 段间延迟（300~900ms jitter）
    if (!isLast) {
      const jitter = 300 + Math.random() * 600; // 300~900ms
      await sleep(jitter);
    }
  }
  
  const fullMessage = segments.map(s => s.text).join(' ');
  
  return {
    chunks,
    fullMessage,
    interrupted,
    sentCount: chunks.length,
    totalCount: segments.length
  };
}

/**
 * 标记房间中断（用户插话）
 * @param {string} roomId
 */
function markInterrupted(roomId) {
  roomInterrupts.set(roomId, true);
  console.log(`[ChunkScheduler] 房间${roomId}标记为中断`);
}

/**
 * 构建 debugMeta（仅最后一段）
 */
function buildDebugMeta(policy, segments) {
  return {
    eventType: policy.reason,
    roleKey: policy.roleKey,
    reason: policy.reason,
    urgency: policy.urgency,
    segmentCount: segments.length,
    segmentTypes: segments.map(s => s.type),
    keyEntities: policy.keyEntities,
    quoteSnippet: policy.quoteSnippet,
    debounceMs: policy.debounceMs,
    cooldownMs: policy.cooldownMs
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  scheduleChunks,
  markInterrupted
};
