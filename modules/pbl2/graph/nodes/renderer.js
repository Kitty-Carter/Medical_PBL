// 节点7: render_segments - 短消息分段输出
const { DeepSeekClient } = require('../../deepseek/deepseekClient');
const { robustParseJSON } = require('./jsonParser');
const config = require('../../config/config');

const client = new DeepSeekClient();

async function renderSegments(graphState) {
  const { turnPlan } = graphState;

  const systemPrompt = getRenderSystemPrompt(turnPlan.roleKey);
  const userPrompt = getRenderUserPrompt(turnPlan);

  try {
    const response = await client.chat({
      model: config.deepseek.modelChat,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: { type: 'json_object' },
      temperature: 0.8,
      maxTokens: 700, // 严格限制
      tag: `render_segments_${turnPlan.roleKey}`,
    });

    const parseResult = robustParseJSON(response.content, `renderer_${turnPlan.roleKey}`);

    if (parseResult.success && parseResult.data.segments) {
      let segments = parseResult.data.segments.filter(s => s.text && s.text.trim().length > 0);
      
      if (segments.length === 0) {
        throw new Error('No valid segments');
      }

      return {
        segments,
        usageRenderer: response.usage,
        renderOk: true,
        parseModeTried: parseResult.parseModeTried,
      };
    } else {
      // 解析失败，使用确定性 segments
      console.warn('[Renderer] JSON解析失败，使用确定性segments');
      return {
        segments: buildDeterministicSegments(turnPlan),
        usageRenderer: response.usage,
        renderOk: false,
        parseModeTried: parseResult.parseModeTried,
        fallbackReason: 'parse_failed',
      };
    }
  } catch (error) {
    console.error('[Renderer] 错误:', error.message);
    return {
      segments: buildDeterministicSegments(turnPlan),
      usageRenderer: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      renderOk: false,
      parseModeTried: ['api_error'],
      fallbackReason: 'api_error',
    };
  }
}

function getRenderSystemPrompt(roleKey) {
  const roleNames = { teacher: 'A教授', B: 'B同学', C: 'C同学' };
  return `你是${roleNames[roleKey]}。将计划转为自然短对话。每段<180字，包含具体事实，不编造，不套话。输出JSON segments数组。`;
}

function getRenderUserPrompt(turnPlan) {
  const factsStr = turnPlan.keyFactCluster.join(';');
  const actionsStr = turnPlan.nextActions.join(';');

  return `角色:${turnPlan.roleKey}
动作链:${turnPlan.speechActs.join('->')}
事实:${factsStr}
矛盾:${turnPlan.mainContradiction}
动作:${actionsStr}
问题:${turnPlan.questionOrBranch}
段数:${turnPlan.segmentSpec.count}

输出JSON:
{"segments":[
  {"type":"${turnPlan.speechActs[0]}","text":"承接+事实..."},
  {"type":"${turnPlan.speechActs[1] || 'question'}","text":"矛盾/动作..."},
  {"type":"question","text":"${turnPlan.questionOrBranch.slice(0, 50)}..."}
]}`;
}

/**
 * 确定性 segments 生成（程序化，满足校验）
 */
function buildDeterministicSegments(turnPlan) {
  const segments = [];
  const roleKey = turnPlan.roleKey;
  const acts = turnPlan.speechActs || [];

  // 根据角色和动作链生成
  if (roleKey === 'teacher') {
    // acknowledge
    segments.push({
      type: 'acknowledge',
      text: `好的，我注意到${turnPlan.keyFactCluster[0] || '当前情况'}。`,
    });

    // priority_correction + 矛盾
    segments.push({
      type: 'priority_correction',
      text: `现在的主要矛盾是：${turnPlan.mainContradiction}。${turnPlan.keyFactCluster[1] || ''}需要优先处理。`,
    });

    // tasking + 动作
    if (turnPlan.nextActions.length > 0) {
      segments.push({
        type: 'tasking',
        text: `B同学，请你${turnPlan.nextActions[0]}。C同学，你来${turnPlan.nextActions[1] || '补充证据链'}。`,
      });
    }

    // branch_question
    segments.push({
      type: 'branch_question',
      text: turnPlan.questionOrBranch,
    });
  } else if (roleKey === 'B') {
    // stance
    segments.push({
      type: 'stance',
      text: `我认为这个观点有问题。${turnPlan.keyFactCluster[0] || ''}说明${turnPlan.mainContradiction}。`,
    });

    // contradiction_attack + 动作
    segments.push({
      type: 'contradiction_attack',
      text: `${turnPlan.nextActions[0] || '证据不足'}，${turnPlan.keyFactCluster[1] || '需要更多检查'}。`,
    });

    // challenge_question
    segments.push({
      type: 'challenge_question',
      text: turnPlan.questionOrBranch,
    });
  } else {
    // C
    // supplement
    segments.push({
      type: 'supplement',
      text: `我补充一下证据链：${turnPlan.keyFactCluster[0] || ''}支持${turnPlan.mainContradiction}。`,
    });

    // operational_next_step
    segments.push({
      type: 'operational_next_step',
      text: `建议${turnPlan.nextActions[0] || '完善检查'}，${turnPlan.keyFactCluster[1] || '观察后续变化'}。`,
    });

    // closure_question
    if (turnPlan.questionOrBranch) {
      segments.push({
        type: 'closure_question',
        text: turnPlan.questionOrBranch,
      });
    }
  }

  // 限制段数
  return segments.slice(0, turnPlan.segmentSpec?.count || 3);
}

module.exports = { renderSegments };
