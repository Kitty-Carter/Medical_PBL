// per-room lock + global concurrency limiter（修复版）
const config = require('../config/config');

const roomLocks = new Map();
let globalRunningCount = 0;

/**
 * 获取房间锁（带超时保护）
 */
async function acquireRoomLock(roomCode, timeoutMs = 30000) {
  const startTime = Date.now();
  
  while (roomLocks.get(roomCode)) {
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      throw new Error(`房间锁获取超时 roomCode=${roomCode}`);
    }
    await sleep(50);
  }
  
  roomLocks.set(roomCode, { acquiredAt: Date.now() });
  
  return Date.now() - startTime; // 返回等待时长
}

/**
 * 释放房间锁（必须在 finally 中调用）
 */
function releaseRoomLock(roomCode) {
  const lockInfo = roomLocks.get(roomCode);
  roomLocks.delete(roomCode);
  
  if (lockInfo) {
    const holdMs = Date.now() - lockInfo.acquiredAt;
    return holdMs;
  }
  return 0;
}

/**
 * 等待全局并发限制
 */
async function waitForGlobalSlot() {
  while (globalRunningCount >= config.concurrency.globalMaxConcurrent) {
    await sleep(100);
  }
  globalRunningCount++;
}

/**
 * 释放全局槽位（必须在 finally 中调用）
 */
function releaseGlobalSlot() {
  if (globalRunningCount > 0) {
    globalRunningCount--;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  acquireRoomLock,
  releaseRoomLock,
  waitForGlobalSlot,
  releaseGlobalSlot,
};
