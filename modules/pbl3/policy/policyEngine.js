/**
 * Policy Engine：事件驱动策略引擎
 * 职责：决定 shouldRespond / 谁回应 / 何时回应 / 是否合并 / 是否插队
 */

const { shouldDebounce, shouldCooldown } = require('./debounceCooldown');
const { selectNextRole } = require('./roleRotation');

/**
 * 策略决策主函数
 * @param {Object} event - Translator 输出的 Event
 * @param {Object} room - 房间状态
 * @returns {Object} PolicyDecision
 */
function decidePolicyFor(event, room) {
  const { type, flags, entities, infoScore, quoteSnippetCandidate } = event;
  const { state = {} } = room;
  
  console.log(`[Policy] 评估事件: ${type}`);
  
  // 1. 特殊事件：room_close
  if (type === 'room_close') {
    return {
      shouldRespond: false,
      reason: 'room_closing'
    };
  }
  
  // 2. 红旗事件：立即插队，忽略冷却
  if (type === 'red_flag' || flags.redFlagDetected) {
    return {
      shouldRespond: true,
      roleKey: 'teacher',
      reason: 'red_flag',
      urgency: 'high',
      debounceMs: 0,
      cooldownMs: 0, // 忽略冷却
      meetingActPlan: ['acknowledge', 'priority', 'tasking', 'branch'],
      quoteSnippet: quoteSnippetCandidate,
      keyEntities: extractKeyEntities(entities, 3),
      skipCooldown: true
    };
  }
  
  // 3. 检查冷却期
  const cooldownCheck = shouldCooldown(room);
  if (cooldownCheck.shouldWait && type !== 'red_flag') {
    console.log(`[Policy] 冷却中，跳过回应 (剩余${cooldownCheck.remainingMs}ms)`);
    return {
      shouldRespond: false,
      reason: 'cooldown',
      remainingMs: cooldownCheck.remainingMs
    };
  }
  
  // 4. AI 长文粘贴：teacher digest
  if (type === 'ai_paste' || flags.aiPasteSuspected) {
    return {
      shouldRespond: true,
      roleKey: 'teacher',
      reason: 'digest_ai_paste',
      urgency: 'normal',
      debounceMs: 1000,
      cooldownMs: 5000,
      meetingActPlan: ['acknowledge', 'priority', 'tasking', 'branch'],
      quoteSnippet: quoteSnippetCandidate,
      keyEntities: extractKeyEntities(entities, 2),
      useReasoner: true // AI长文需要reasoner消化
    };
  }
  
  // 5. 新病例发布：teacher opening
  if (type === 'case_posted') {
    return {
      shouldRespond: true,
      roleKey: 'teacher',
      reason: 'case_opening',
      urgency: 'normal',
      debounceMs: 2000,
      cooldownMs: 4000,
      meetingActPlan: ['acknowledge', 'priority', 'tasking', 'branch'],
      quoteSnippet: quoteSnippetCandidate,
      keyEntities: extractKeyEntities(entities, 2),
      useReasoner: true // 开场需要reasoner
    };
  }
  
  // 6. 学生明确结论：B/C 跟进
  if (type === 'student_claim') {
    const role = selectNextRole(state, 'student_claim');
    return {
      shouldRespond: true,
      roleKey: role,
      reason: 'claim_followup',
      urgency: 'normal',
      debounceMs: shouldDebounce(room) ? 3000 : 0,
      cooldownMs: 4000,
      meetingActPlan: role === 'B' ? ['stance', 'contradiction', 'challenge'] : ['evidence_chain', 'plan', 'closure'],
      quoteSnippet: quoteSnippetCandidate,
      keyEntities: extractKeyEntities(entities, 2)
    };
  }
  
  // 7. 证据更新：C 跟进
  if (type === 'evidence_update') {
    return {
      shouldRespond: true,
      roleKey: 'C',
      reason: 'evidence_followup',
      urgency: 'normal',
      debounceMs: shouldDebounce(room) ? 4000 : 0,
      cooldownMs: 5000,
      meetingActPlan: ['evidence_chain', 'plan'],
      quoteSnippet: quoteSnippetCandidate,
      keyEntities: extractKeyEntities(entities, 2)
    };
  }
  
  // 8. 噪音重定向
  if (type === 'noise' && state.agendaStage) {
    // 连续低信息量消息
    const recentLowInfo = countRecentLowInfo(state.transcript || []);
    if (recentLowInfo >= 2) {
      return {
        shouldRespond: true,
        roleKey: 'teacher',
        reason: 'redirect_noise',
        urgency: 'low',
        debounceMs: 5000,
        cooldownMs: 8000,
        meetingActPlan: ['priority', 'branch'], // 短纠偏
        quoteSnippet: quoteSnippetCandidate,
        keyEntities: extractKeyEntities(entities, 1)
      };
    }
  }
  
  // 9. 默认：不回应
  return {
    shouldRespond: false,
    reason: 'no_trigger'
  };
}

/**
 * 提取关键实体（用于 RelevanceGuard）
 */
function extractKeyEntities(entities, count = 2) {
  const keywords = [];
  
  // 优先生命体征
  if (entities.vitalSigns) {
    keywords.push(...Object.keys(entities.vitalSigns).map(k => `${k}:${entities.vitalSigns[k]}`));
  }
  
  // 症状
  if (entities.symptoms) {
    keywords.push(...entities.symptoms);
  }
  
  // 体征
  if (entities.physicalExam) {
    keywords.push(...entities.physicalExam);
  }
  
  // 化验
  if (entities.labs) {
    keywords.push(...Object.keys(entities.labs).map(k => `${k}:${entities.labs[k]}`));
  }
  
  return keywords.slice(0, Math.max(count, 2));
}

/**
 * 统计最近的低信息量消息数
 */
function countRecentLowInfo(transcript) {
  const recent = transcript.slice(-5);
  return recent.filter(msg => msg.infoScore < 3).length;
}

module.exports = {
  decidePolicyFor
};
