// 分段消息发送调度器（带抖动 + 中断丢弃）
const config = require('../config/config');

/**
 * 调度分段消息发送
 * @param {Array<Segment>} segments
 * @param {Function} emitFn - (segment, isLast) => Promise<boolean> 返回false表示被中断
 * @returns {Promise<Object>} - { sent, discarded, durations }
 */
async function scheduleChunks(segments, emitFn) {
  const durations = [];
  let sent = 0;
  let discarded = 0;

  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const startTime = Date.now();
    
    const ok = await emitFn(segments[i], isLast);
    
    durations.push(Date.now() - startTime);
    
    if (!ok) {
      // 被中断，丢弃后续
      discarded = segments.length - i - 1;
      break;
    }
    
    sent++;
    
    if (!isLast) {
      const jitter = calculateJitter();
      await sleep(jitter);
    }
  }

  return { sent, discarded, durations };
}

/**
 * 计算抖动延迟
 */
function calculateJitter() {
  const min = config.chunking.minIntervalMs;
  const max = config.chunking.maxIntervalMs;
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  scheduleChunks,
};
