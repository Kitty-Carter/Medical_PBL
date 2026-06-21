/**
 * 简化的 Segment 生成器（P0版本）
 * 后续完善为完整的 DeepSeek API 调用
 */

/**
 * 生成 segments（临时简化版）
 */
async function generateSegments(room, policy, event) {
  const { roleKey, meetingActPlan, quoteSnippet, keyEntities } = policy;
  
  console.log(`[SimpleRenderer] 生成${roleKey}的回应`);
  
  // 临时：程序化生成（后续接入DeepSeek API）
  const segments = [];
  
  if (roleKey === 'teacher') {
    // Teacher 必须: acknowledge, priority, tasking, branch
    segments.push({
      type: 'acknowledge',
      text: `注意到"${quoteSnippet}"，这提示了${keyEntities[0] || '关键信息'}需要关注。`
    });
    
    segments.push({
      type: 'priority',
      text: `当前主要矛盾是${keyEntities.join('、')}之间的关系，需要明确优先级。`
    });
    
    segments.push({
      type: 'tasking',
      text: `B同学请质疑诊断依据是否充分，C同学请补充证据链和下一步检查。`
    });
    
    segments.push({
      type: 'branch',
      text: `如果是A情况我们怎么处理？如果是B情况又该如何？`
    });
    
  } else if (roleKey === 'B') {
    // B 必须: stance, contradiction, challenge
    segments.push({
      type: 'stance',
      text: `我质疑这个结论。病例提到"${quoteSnippet}"，但${keyEntities[0] || '关键证据'}还不足以支持这个诊断。`
    });
    
    segments.push({
      type: 'contradiction',
      text: `过早收敛可能忽略了其他危险诊断，${keyEntities.join('、')}的组合还需要排除更多可能。`
    });
    
    segments.push({
      type: 'challenge',
      text: `用什么阈值来排除？依据是什么？`
    });
    
  } else if (roleKey === 'C') {
    // C 必须: evidence_chain, operational_next_step
    segments.push({
      type: 'evidence_chain',
      text: `从"${quoteSnippet}"看，${keyEntities[0] || '体征'}提示可能的病理机制是${keyEntities[1] || '病理变化'}。`
    });
    
    segments.push({
      type: 'operational_next_step',
      text: `建议优先完善${keyEntities.join('、')}相关检查，若48小时无改善则升级治疗。`
    });
    
    if (Math.random() > 0.5) {
      segments.push({
        type: 'closure',
        text: `复评的具体时间点和触发条件是什么？`
      });
    }
  }
  
  return segments;
}

module.exports = {
  generateSegments
};
