/**
 * Per-room Lock + Global Concurrency
 * 同房间同时只有一个AI回合运行
 * 全局最多2-4房间并发
 */

const roomLocks = new Map();
let globalRunningCount = 0;
const MAX_GLOBAL_CONCURRENT = 3;

/**
 * 尝试获取房间锁
 * @param {string} roomId
 * @returns {Promise<Function>} release 函数
 */
async function acquireRoomLock(roomId) {
  // 等待全局并发限制
  while (globalRunningCount >= MAX_GLOBAL_CONCURRENT) {
    await sleep(100);
  }
  
  // 等待房间锁
  while (roomLocks.get(roomId)) {
    await sleep(50);
  }
  
  // 获取锁
  roomLocks.set(roomId, true);
  globalRunningCount++;
  
  console.log(`[Lock] 房间${roomId}获取锁，全局运行数=${globalRunningCount}`);
  
  // 返回释放函数
  return () => {
    roomLocks.delete(roomId);
    globalRunningCount--;
    console.log(`[Lock] 房间${roomId}释放锁，全局运行数=${globalRunningCount}`);
  };
}

/**
 * 检查房间是否被锁定
 * @param {string} roomId
 * @returns {boolean}
 */
function isRoomLocked(roomId) {
  return roomLocks.has(roomId);
}

/**
 * 强制释放房间锁（用于异常情况）
 * @param {string} roomId
 */
function forceReleaseRoomLock(roomId) {
  if (roomLocks.has(roomId)) {
    roomLocks.delete(roomId);
    globalRunningCount = Math.max(0, globalRunningCount - 1);
    console.log(`[Lock] 强制释放房间${roomId}锁`);
  }
}

/**
 * 获取全局运行状态
 */
function getGlobalRunningCount() {
  return globalRunningCount;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  acquireRoomLock,
  isRoomLocked,
  forceReleaseRoomLock,
  getGlobalRunningCount
};
