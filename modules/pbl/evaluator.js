const { ROLE_CARDS, buildEvaluatorPrompt } = require('./promptTemplates');
const { pblConfig } = require('./config');
const { detectLeakage, ENTITY_PATTERN, similarity } = require('./outputGuard');

function containsUnsafeClaim(text, evidenceInsufficient) {
  if (!evidenceInsufficient) return false;
  return /最新指南|202\d.*指南|更新结论/.test(String(text || ''));
}

function evalV2Tags({ renderedText, state, turnTask, recentMessages = [] }) {
  const text = String(renderedText || '');
  const tags = [];
  if (!ENTITY_PATTERN.test(text)) tags.push('缺少病例锚点');
  if (/先稳定循环\/?氧合并同步完成最关键复评指标|先救命和高危排除/.test(text)) tags.push('generic_critical_talk');
  if (!/(先|优先|立即|先做|先完成|先排除)/.test(text)) tags.push('优先级不清');
  if (!/[?？]/.test(text) && turnTask.roleType === 'teacher') tags.push('教学追问不足');
  const latestHuman = [...recentMessages].reverse().find((m) => m.type === 'text' && !String(m.sender?.role || '').startsWith('ai_'));
  if (latestHuman && !text.includes(String((latestHuman.content || '').slice(0, 4)))) tags.push('互动承接弱');
  if (similarity(text, state?.messageSummary || '') < 0.05) tags.push('病例相关性弱');
  if (/另外再说|先不管/.test(text)) tags.push('可能平行发言');
  if (/(请开始|你怎么看|继续讨论)/.test(String(turnTask?.targetPoint || ''))) tags.push('targetPoint低信息量');
  if (!/(先|优先|立即)/.test(text) && /(休克|低血压|高乳酸|持续出血|意识异常)/.test(state?.messageSummary || '')) tags.push('临床优先级错误');
  if (!/(矛盾|冲突|不一致|分叉|A\/B|如果.*则)/.test(text)) tags.push('no_contradiction');
  if (!/[?？]/.test(text)) tags.push('no_question_or_branch');
  return tags;
}

function ruleEvaluate({ turnTask, draft, renderedText, evidencePack, recentMessages = [], state }) {
  const leak = detectLeakage(renderedText);
  const latestAI = [...recentMessages].reverse().find((m) => m.type === 'text' && String(m.sender?.role || '').startsWith('ai_'));
  const repeated = latestAI ? similarity(renderedText || '', latestAI.content || '') >= 0.6 : false;
  const hasEntity = ENTITY_PATTERN.test(String(renderedText || ''));
  const relatedToCase = hasEntity || /(DIC|休克|凝血|乳酸|血压|纤维蛋白原|PLT|PT|APTT)/i.test(`${state?.messageSummary || ''} ${renderedText || ''}`);

  if (leak) {
    return {
      passed: false,
      score: 0,
      subscores: { relevance: 0, advancement: 0, logic: 0, roleConsistency: 0, medicalSafety: 0 },
      issues: ['检测到任务说明/模板泄露文本'],
      retrySuggestion: '禁止输出任务指令句，改为病例事实+推理+动作+追问。',
    };
  }
  if (repeated) {
    return {
      passed: false,
      score: 2,
      subscores: { relevance: 1, advancement: 0, logic: 1, roleConsistency: 0, medicalSafety: 0 },
      issues: ['与上一轮内容重复度过高'],
      retrySuggestion: '必须引入新证据或新分叉问题，避免复述。',
    };
  }
  let relevance = draft?.replyTo?.point ? 2 : 1;
  let advancement = draft?.questions?.length || draft?.proposedNextStep ? 2 : 1;
  let logic = (draft?.reasoningBullets || []).length >= 2 ? 2 : 1;
  let roleConsistency = 2;
  let medicalSafety = containsUnsafeClaim(renderedText, evidencePack.evidenceInsufficient) ? 0 : 2;
  if (!relatedToCase) relevance = 0;
  if (!hasEntity) advancement = 0;
  if (turnTask.roleType === 'teacher' && !/[?？]/.test(renderedText || '')) advancement = Math.max(0, advancement - 1);
  const tags = evalV2Tags({ renderedText, state, turnTask, recentMessages });
  if (tags.includes('缺少病例锚点')) relevance = Math.min(relevance, 1);
  if (tags.includes('优先级不清')) logic = Math.min(logic, 1);
  if (tags.includes('互动承接弱')) roleConsistency = Math.min(roleConsistency, 1);
  const score = relevance + advancement + logic + roleConsistency + medicalSafety;
  return {
    passed: score >= pblConfig.evalThreshold,
    score,
    subscores: { relevance, advancement, logic, roleConsistency, medicalSafety },
    issues: score >= pblConfig.evalThreshold ? [] : ['规则评估未达标，建议加强针对性与证据约束'],
    tags,
    retrySuggestion: score >= pblConfig.evalThreshold ? '' : '请明确回应对象观点，并补一个可执行验证动作，避免泛泛表述。',
  };
}

async function evaluateTurn({ client, turnTask, state, draft, renderedText, evidencePack, recentMessages = [] }) {
  if (!client.enabled()) return ruleEvaluate({ turnTask, draft, renderedText, evidencePack, recentMessages, state });
  const roleCard = ROLE_CARDS[turnTask.roleType] || ROLE_CARDS.student_critic;
  const prompt = buildEvaluatorPrompt({ roleCard, turnTask, state, draft, renderedText, evidencePack });
  const tryModel = async (model, tag) => {
    const res = await client.chatJson({
      model,
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: '只输出 EvalResult JSON。' }],
      max_tokens: 900,
      temperature: 0.2,
      tag,
      model_routing_stage: 'evaluator',
    });
    return res.parsed;
  };
  let parsed = null;
  try {
    parsed = await tryModel(pblConfig.modelThinking, 'evaluator_thinking');
  } catch (_) {}
  if (!parsed) {
    try {
      parsed = await tryModel(pblConfig.modelRole, 'evaluator_lite_fallback');
    } catch (_) {}
  }
  if (!parsed) return ruleEvaluate({ turnTask, draft, renderedText, evidencePack, recentMessages, state });
  const base = ruleEvaluate({ turnTask, draft, renderedText, evidencePack, recentMessages, state });
  if (!base.passed) return base;
  return {
    ...parsed,
    tags: base.tags || [],
  };
}

module.exports = {
  evaluateTurn,
  ruleEvaluate,
};
