// per-room state storage (in-memory)
const { createInitialState } = require('../graph/state');

const roomStates = new Map();

/**
 * 获取或创建房间状态
 */
function ensureState(roomCode) {
  if (!roomStates.has(roomCode)) {
    roomStates.set(roomCode, createInitialState(roomCode));
  }
  return roomStates.get(roomCode);
}

/**
 * 获取状态（只读）
 */
function getState(roomCode) {
  return roomStates.get(roomCode);
}

/**
 * 清除状态
 */
function clearState(roomCode) {
  roomStates.delete(roomCode);
}

module.exports = {
  ensureState,
  getState,
  clearState,
};
