// 节点: planner - 通过 AstrBot Webhook 输出 JSON segments
const { AstrBotClient } = require('../../astrbot/client');
const { buildMessages } = require('../../prompts/contextBuilder');
const { robustParseJSON } = require('./jsonParser');
const config = require('../../config/config');

const client = new AstrBotClient();

/**
 * 生成 AI 回复（直接输出 JSON segments）
 * @returns {segments, usage, modelUsed, parseOk}
 */
async function generateReply(graphState) {
  const { state, room, speakerDecision } = graphState;
  const roleKey = speakerDecision.nextSpeaker;
  const eventType = speakerDecision.reason;

  console.log(`[Planner] 角色=${roleKey}, 事件=${eventType}`);

  // 1. 决策提示强度：仅长文本/总结时启用 rigorous prompt
  const useRigorousPrompt = needMoreRigorousParams(state, eventType, roleKey);
  const promptMode = useRigorousPrompt ? 'rigorous' : 'normal';
  const modelToUse = `astrbot:${roleKey}`;

  console.log(`[Planner] 提供方=${modelToUse}, 模式=${promptMode}`);

  // 2. 构建 messages（传递 room）
  const messages = buildMessages(state, room, roleKey, eventType);

  // 3. 调用 AstrBot Webhook
  try {
    const response = await client.chat({
      roleKey,
      roomCode: room.roomCode,
      eventType,
      promptMode,
      messages,
      senderName: room.teacherName || 'Medical_PBL',
      senderId: room.teacherId || room.roomCode || 'medical-pbl',
    });

    console.log(`[Planner] AstrBot 响应成功, promptChars=${response.usage?.promptChars || 0}`);
    
    // Debug: 打印返回内容（仅前 200 字符）
    if (config.debug) {
      console.log(`[Planner] 返回内容前200字: ${response.content.slice(0, 200)}`);
    }

    // 4. 解析 JSON
    const parseResult = robustParseJSON(response.content, `${roleKey}_${eventType}`);

    if (!parseResult.success) {
      console.warn('[Planner] JSON解析失败，重试一次（强化协议）');
      
      // 重试一次（强化输出协议）
      if (!graphState.retryCount || graphState.retryCount < 1) {
        console.log('[Planner] 重试一次');
        graphState.retryCount = (graphState.retryCount || 0) + 1;
        return await generateReply(graphState);
      }
      
      // 仍失败 -> fallback
      return buildFallbackSegments(roleKey, state, room, response.usage);
    }

    // 5. 校验 segments 格式
    const segments = parseResult.data.segments || [];
    
    // 生成 turnPlan（用于 validator）
    const { deterministicMinPlan } = require('./minPlanBuilder');
    const turnPlan = deterministicMinPlan(state, room, roleKey, eventType);
    
    // 调用 validator（传入 graphState）
    const { validateSegments: validatorFunc } = require('./validator');
    const validationResult = validatorFunc({ segments, turnPlan, state });

    if (!validationResult.isValid) {
      console.warn(`[Planner] segments校验失败:`, validationResult.validationErrors);
      
      // 重试一次（强化输出协议）
      if (!graphState.retryCount || graphState.retryCount < 1) {
        console.log('[Planner] 重试一次（强化协议）');
        graphState.retryCount = (graphState.retryCount || 0) + 1;
        return await generateReply(graphState);
      }
      
      // 仍失败 -> fallback
      return buildFallbackSegments(roleKey, state, room, response.usage);
    }

    return {
      segments,
      usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      modelUsed: response.model || modelToUse,
      parseOk: true,
      parseModeTried: parseResult.parseModeTried,
      turnPlan, // 必须返回，用于 debugMeta 和 validator
    };

  } catch (error) {
    console.error('[Planner] AstrBot 调用失败:', error.message);
    
    // API 失败 -> fallback
    return buildFallbackSegments(roleKey, state, room, null, error.message);
  }
}

/**
 * 判断是否需要更严谨的参数（降低温度，增加tokens）
 * 替代 reasoner 策略
 */
function needMoreRigorousParams(state, eventType, roleKey) {
  // 1. 新病例开场
  if (eventType === 'teacher_opening') {
    return true;
  }

  // 2. AI长文消化
  if (eventType === 'ai_paste_suspected') {
    return true;
  }

  // 3. 阶段总结
  if (eventType === 'teacher_summary') {
    return true;
  }

  // 4. 讨论失控
  if (state.openLoops && state.openLoops.length > 3) {
    return true;
  }

  return false;
}

/**
 * 程序化 fallback segments（不调用LLM，使用 deterministicMinPlan）
 */
function buildFallbackSegments(roleKey, state, room, usage, errorMsg) {
  console.warn(`[Planner] 使用fallback segments (deterministic), roleKey=${roleKey}`);
  
  // 使用 deterministicMinPlan 生成槽位化的 segments
  const { deterministicMinPlan } = require('./minPlanBuilder');
  const { validateSegments } = require('./validator');
  
  try {
    const turnPlan = deterministicMinPlan(state, room, roleKey, 'fallback');
    
    // 将 turnPlan 转换为 segments（简化版，直接使用关键事实）
    const segments = generateSegmentsFromPlan(turnPlan, roleKey);
    
    // 验证一下
    const graphState = { segments, turnPlan, state };
    const validation = validateSegments(graphState);
    
    if (validation.isValid) {
      console.log('[Planner] Fallback segments 通过验证');
    } else {
      console.warn('[Planner] Fallback segments 验证失败:', validation.validationErrors);
    }
    
    return {
      segments,
      usage: usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      modelUsed: 'deterministic_fallback',
      parseOk: false,
      fallbackReason: errorMsg || 'unknown',
      turnPlan, // 必须返回，用于 validator
    };
  } catch (err) {
    console.error('[Planner] Fallback 生成失败:', err.message);
    // 最终兜底
    return {
      segments: getEmergencySegments(roleKey),
      usage: usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      modelUsed: 'emergency_fallback',
      parseOk: false,
      fallbackReason: err.message,
    };
  }
}

/**
 * 从 turnPlan 生成 segments
 */
function generateSegmentsFromPlan(turnPlan, roleKey) {
  const segments = [];
  const { quoteSnippet, keyFactCluster, mainContradiction, nextActions, questionOrBranch } = turnPlan;
  
  if (roleKey === 'teacher') {
    // acknowledge（必须包含引用锚点）
    if (quoteSnippet) {
      segments.push({
        type: 'acknowledge',
        text: `${quoteSnippet}，这是本病例的关键特征。`
      });
    } else {
      segments.push({
        type: 'acknowledge',
        text: `注意到${keyFactCluster[0] || '当前病情'}，需要重点关注。`
      });
    }
    
    // priority_correction
    segments.push({
      type: 'priority',
      text: mainContradiction
    });
    
    // tasking
    segments.push({
      type: 'tasking',
      text: 'B同学找出推理漏洞，C同学补充证据链节点。'
    });
    
    // branch_question
    segments.push({
      type: 'question',
      text: questionOrBranch
    });
    
  } else if (roleKey === 'B') {
    // stance
    segments.push({
      type: 'stance',
      text: `我质疑当前推理：${keyFactCluster[0] || '关键证据'}尚未充分排除其他诊断。`
    });
    
    // challenge_question
    segments.push({
      type: 'question',
      text: questionOrBranch
    });
    
  } else { // C
    // evidence_chain
    segments.push({
      type: 'evidence_chain',
      text: `基于${keyFactCluster[0] || '当前体征'}，${nextActions[0] || '需要补充检查'}。`
    });
    
    // operational_next_step
    segments.push({
      type: 'plan',
      text: nextActions[1] || '建立复评时间点，监测指标变化。'
    });
  }
  
  return segments;
}

/**
 * 紧急兜底 segments（最简化）
 */
function getEmergencySegments(roleKey) {
  const emergency = {
    teacher: [
      { type: 'acknowledge', text: '当前需要明确病例关键信息。' },
      { type: 'priority', text: '主要矛盾是信息不完整。' },
      { type: 'tasking', text: 'B同学质疑诊断，C同学补证据链。' },
      { type: 'question', text: '我们现在缺少哪些关键检查？' },
    ],
    B: [
      { type: 'stance', text: '我认为当前推理不够严谨。' },
      { type: 'question', text: '排除依据和阈值是什么？' },
    ],
    C: [
      { type: 'evidence_chain', text: '需要补充关键检查闭环。' },
      { type: 'plan', text: '建议24小时后复评。' },
    ],
  };
  
  return emergency[roleKey] || emergency.teacher;
}

module.exports = { generateReply };
