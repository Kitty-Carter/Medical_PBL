// PBL2 主入口函数（重写版：finally 释放锁）
const { ensureState } = require('./runtime/roomStore');
const { acquireRoomLock, releaseRoomLock, waitForGlobalSlot, releaseGlobalSlot } = require('./runtime/locks');
const { executePBLTurn } = require('./graph/graph');
const { recordTurn } = require('./runtime/metrics');
const config = require('./config/config');

async function nextTurnV2(room, opts = {}) {
  const roomCode = room.roomCode;
  const startTime = Date.now();
  let success = false;
  let lockWaitMs = 0;
  let lockHoldMs = 0;

  try {
    // 并发控制
    await waitForGlobalSlot();
    lockWaitMs = await acquireRoomLock(roomCode);

    // 获取或创建状态
    const state = ensureState(roomCode);

    // 执行完整流程
    const result = await executePBLTurn(state, room, lockWaitMs, opts);

    success = true;
    const duration = Date.now() - startTime;
    recordTurn(true, duration);

    return {
      ...result,
      pipelineVersion: config.pipelineVersion,
      provider: 'astrbot',
      duration,
      lockWaitMs,
      lockHoldMs: Date.now() - startTime - lockWaitMs,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    recordTurn(false, duration);

    console.error('[PBL2][nextTurnV2] 错误:', error.message);
    throw error;
  } finally {
    // 必须释放锁
    lockHoldMs = releaseRoomLock(roomCode);
    releaseGlobalSlot();
    
    if (lockWaitMs > 1000) {
      console.warn(`[PBL2][Lock] 等待时间过长 lockWaitMs=${lockWaitMs}ms roomCode=${roomCode}`);
    }
  }
}

module.exports = {
  nextTurnV2,
};
