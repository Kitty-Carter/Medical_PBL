/**
 * PBL3 主入口：nextTurnV3
 * 三层架构：Translator → Policy → Renderer
 */

const { translateMessage } = require('./translator');
const { decidePolicyFor } = require('./policy/policyEngine');
const { acquireRoomLock } = require('./policy/locks');
const { recordResponse, clearCooldown } = require('./policy/debounceCooldown');

// P1：完整 renderer（真实DeepSeek API）
const { generateSegments } = require('./renderer/fullRenderer');
const { scheduleChunks } = require('./renderer/chunkScheduler');

/**
 * PBL3 主函数
 * @param {Object} room - 房间对象
 * @param {Object} incomingMessage - 用户消息 { speaker, text, ts }
 * @returns {Promise<Object>} AI回应结果
 */
async function nextTurnV3(room, incomingMessage) {
  const roomId = room.roomId;
  
  console.log(`\n[PBL3] ===== 房间${roomId}新消息 =====`);
  console.log(`[PBL3] 发言者: ${incomingMessage.speaker}`);
  console.log(`[PBL3] 内容: ${incomingMessage.text.substring(0, 50)}...`);
  
  try {
    // ===== 第1层：Translator =====
    const event = translateMessage(room, incomingMessage);
    console.log(`[PBL3] Event类型: ${event.type}, 信息量: ${event.infoScore}, 实体: ${event.entities.allKeywords.length}个`);
    
    // ===== 第2层：Policy =====
    const policy = decidePolicyFor(event, room);
    console.log(`[PBL3] Policy决策: shouldRespond=${policy.shouldRespond}, reason=${policy.reason}`);
    
    if (!policy.shouldRespond) {
      console.log(`[PBL3] 跳过回应: ${policy.reason}`);
      return {
        shouldRespond: false,
        reason: policy.reason,
        eventType: event.type
      };
    }
    
    // ===== 获取锁 =====
    const releaseLock = await acquireRoomLock(roomId);
    
    try {
      console.log(`[PBL3] 准备生成回应: ${policy.roleKey} (${policy.reason})`);
      
      // ===== 第3层：Renderer =====
      const renderResult = await generateSegments(room, policy, event);
      
      console.log(`[PBL3] 生成${renderResult.segments.length}个段落，模型=${renderResult.modelUsed}`);
      
      // ===== 分段发送 =====
      const chunkResult = await scheduleChunks(room, renderResult.segments, policy);
      
      // ===== 记录冷却 =====
      if (!policy.skipCooldown) {
        recordResponse(roomId, policy.cooldownMs || 4000);
      } else {
        clearCooldown(roomId);
      }
      
  // 更新房间状态
  updateRoomState(room, policy, renderResult.segments);
      
      return {
        shouldRespond: true,
        roleKey: policy.roleKey,
        roleName: getRoleName(policy.roleKey),
        segments: renderResult.segments,
        chunks: chunkResult.chunks,
        fullMessage: chunkResult.fullMessage,
        eventType: event.type,
        policyReason: policy.reason,
        urgency: policy.urgency,
        usage: renderResult.usage,
        modelUsed: renderResult.modelUsed,
        debugMeta: {
          eventType: event.type,
          shouldRespond: true,
          roleKey: policy.roleKey,
          reason: policy.reason,
          urgency: policy.urgency,
          entities: event.entities.allKeywords.slice(0, 10),
          keyEntities: policy.keyEntities,
          quoteSnippetUsed: policy.quoteSnippet,
          relevanceGuardPassed: renderResult.relevanceCheck?.passed !== false,
          relevanceCheck: renderResult.relevanceCheck,
          modelUsed: renderResult.modelUsed,
          usage: renderResult.usage,
          debounceMs: policy.debounceMs,
          cooldownMs: policy.cooldownMs,
          interruptedByUser: chunkResult.interrupted
        }
      };
      
    } finally {
      releaseLock();
    }
    
  } catch (error) {
    console.error(`[PBL3] 错误:`, error.message);
    throw error;
  }
}

/**
 * 更新房间状态
 */
function updateRoomState(room, policy, segments) {
  const { state } = room;
  
  // 更新最近发言角色
  if (!state.lastSpeakers) state.lastSpeakers = [];
  state.lastSpeakers.push(policy.roleKey);
  if (state.lastSpeakers.length > 10) {
    state.lastSpeakers = state.lastSpeakers.slice(-10);
  }
  
  // 更新transcript
  if (!state.transcript) state.transcript = [];
  const fullMessage = segments.map(s => s.text).join(' ');
  state.transcript.push({
    roleKey: policy.roleKey,
    speaker: getRoleName(policy.roleKey),
    text: fullMessage,
    ts: Date.now()
  });
}

/**
 * 获取角色中文名
 */
function getRoleName(roleKey) {
  const names = {
    teacher: 'A教授',
    B: 'B同学',
    C: 'C同学'
  };
  return names[roleKey] || roleKey;
}

module.exports = {
  nextTurnV3
};
