/**
 * 完整 Renderer（集成DeepSeek API）
 * P1版本：真实LLM调用 + RelevanceGuard + Validator
 */

const { callChat, callReasoner } = require('../deepseek/deepseekClient');
const { buildMessages } = require('./promptBuilder');
const { checkRelevance, generateRelevanceHints } = require('./relevanceGuard');
const { validateSegments } = require('./segmentValidator');

/**
 * 生成 segments（完整版）
 */
async function generateSegments(room, policy, event) {
  const { roleKey, useReasoner } = policy;
  
  console.log(`[Renderer] 生成${roleKey}的回应 (useReasoner=${useReasoner})`);
  
  // 1. 构建 messages
  const messages = buildMessages(room, policy, event);
  
  // 2. 决定使用哪个模型
  let response;
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      // 调用 DeepSeek API
      if (useReasoner && retryCount === 0) {
        response = await callReasoner(messages, {
          temperature: 0.4,
          maxTokens: 1200
        });
      } else {
        response = await callChat(messages, {
          temperature: 1.1,
          maxTokens: 700
        });
      }
      
      // 3. 解析 JSON
      const parsed = parseSegmentsJSON(response.content);
      if (!parsed.success) {
        throw new Error(`JSON解析失败: ${parsed.error}`);
      }
      
      const segments = parsed.data.segments || [];
      
      // 4. 基本验证
      const validation = validateSegments(segments, roleKey);
      if (!validation.valid) {
        throw new Error(`Segment验证失败: ${validation.errors.join(', ')}`);
      }
      
      // 5. RelevanceGuard
      const relevanceCheck = checkRelevance(segments, policy, event);
      if (!relevanceCheck.passed) {
        console.warn(`[RelevanceGuard] 失败: ${relevanceCheck.reason}`);
        
        if (retryCount < maxRetries) {
          console.log(`[Renderer] 重写一次（添加相关性提示）`);
          const hints = generateRelevanceHints(policy, event);
          messages.push({
            role: 'user',
            content: hints
          });
          retryCount++;
          continue;
        } else {
          // 仍失败 -> fallback
          console.log(`[Renderer] 重写仍失败，使用fallback`);
          return buildFallbackSegments(roleKey, policy, event);
        }
      }
      
      // 成功！
      console.log(`[Renderer] 成功生成${segments.length}个段落`);
      return {
        segments,
        usage: response.usage,
        modelUsed: response.model,
        relevanceCheck: relevanceCheck.details
      };
      
    } catch (error) {
      console.error(`[Renderer] 生成失败:`, error.message);
      
      if (retryCount < maxRetries) {
        console.log(`[Renderer] 重试 (${retryCount + 1}/${maxRetries})`);
        retryCount++;
      } else {
        // 最终fallback
        console.log(`[Renderer] 所有尝试失败，使用fallback`);
        return buildFallbackSegments(roleKey, policy, event);
      }
    }
  }
  
  // 不应该到这里
  return buildFallbackSegments(roleKey, policy, event);
}

/**
 * 解析 segments JSON
 */
function parseSegmentsJSON(content) {
  try {
    // 清理可能的markdown包裹
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\n?/g, '');
    }
    
    const data = JSON.parse(cleaned);
    
    if (!data.segments || !Array.isArray(data.segments)) {
      return {
        success: false,
        error: 'missing segments array'
      };
    }
    
    return { success: true, data };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fallback segments（程序化生成，仍要对题）
 */
function buildFallbackSegments(roleKey, policy, event) {
  console.warn(`[Renderer] Fallback: ${roleKey}`);
  
  const { quoteSnippet, keyEntities } = policy;
  const segments = [];
  
  if (roleKey === 'teacher') {
    segments.push({
      type: 'acknowledge',
      text: `注意到"${quoteSnippet || '当前情况'}"，需要明确${keyEntities[0] || '关键信息'}。`
    });
    
    segments.push({
      type: 'priority',
      text: `主矛盾是${keyEntities.slice(0, 2).join('与')}的关系，需要优先处理。`
    });
    
    segments.push({
      type: 'tasking',
      text: `B同学请质疑依据，C同学请补充证据链。`
    });
    
    segments.push({
      type: 'branch',
      text: `如果A情况怎么处理？如果B情况又如何？`
    });
    
  } else if (roleKey === 'B') {
    segments.push({
      type: 'stance',
      text: `我质疑这个结论。"${quoteSnippet}"提示${keyEntities[0] || '关键点'}，但证据不足。`
    });
    
    segments.push({
      type: 'contradiction',
      text: `过早收敛可能忽略其他危险，${keyEntities.join('、')}需要更多支持。`
    });
    
    segments.push({
      type: 'challenge',
      text: `排除依据是什么？阈值标准在哪？`
    });
    
  } else if (roleKey === 'C') {
    segments.push({
      type: 'evidence_chain',
      text: `从"${quoteSnippet}"看，${keyEntities[0] || '体征'}提示${keyEntities[1] || '病理'}可能。`
    });
    
    segments.push({
      type: 'operational_next_step',
      text: `建议完善${keyEntities.join('、')}检查，48小时无改善则升级。`
    });
  }
  
  return {
    segments,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    modelUsed: 'fallback',
    relevanceCheck: { note: 'fallback' }
  };
}

module.exports = {
  generateSegments
};
