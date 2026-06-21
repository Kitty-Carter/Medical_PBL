const { ROLE_CARDS, buildRoleDraftPrompt } = require('./promptTemplates');
const { pblConfig } = require('./config');
const { parseRoleDraft } = require('./planParser');
const { buildRoleFallback } = require('./fallbacks');
const { buildCurrentCriticalSnapshot } = require('./currentSnapshot');
const { buildContradictions } = require('./contradictionBuilder');

function buildTechnicalDraft({ turnTask, turnPlan, state, evidencePack, recentMessages, caseUnderstanding }) {
  const snapshot = buildCurrentCriticalSnapshot(state, caseUnderstanding || {});
  const contradictions = buildContradictions({ snapshot, caseUnderstanding: caseUnderstanding || {}, state });
  const fb = buildRoleFallback({ turnTask, state, recentMessages, evidencePack });
  const riskFact = snapshot.organPerfusionRedFlags[0] || snapshot.currentTopRisk || '当前高危风险尚未闭环';
  const contradiction = contradictions.keyContradictions[0] || contradictions.urgentConflicts[0] || '救命优先级与病因细化存在冲突';
  const nextAction = turnPlan?.nextAction || '先完成关键复评指标并在30-60分钟复盘';
  const question = contradictions.pathwaySplitPoints[0] || turnPlan?.branchQuestion || '若关键指标恶化你将如何升级路径？';
  return {
    replyTo: { speaker: turnPlan?.replyTarget?.speaker || turnTask.targetSpeaker || '同学', point: turnPlan?.replyTarget?.point || turnTask.targetPoint || '当前核心争点' },
    stance: `先围绕${riskFact}处理，避免过早收敛`,
    reasoningBullets: [riskFact, contradiction, String(fb).slice(0, 60)].filter(Boolean),
    evidenceNeed: [],
    questions: [question],
    proposedNextStep: nextAction,
    safetyNote: '技术降级：基于病例事实与常规临床路径',
  };
}

async function generateRoleDraft({ client, turnTask, turnPlan, reasoningContext, state, evidencePack, recentExcerpts, recentMessages = [] }) {
  const roleCard = ROLE_CARDS[turnTask.roleType] || ROLE_CARDS.student_critic;
  const prompt = buildRoleDraftPrompt({ roleCard, turnTask, turnPlan, reasoningContext, state, evidencePack, recentExcerpts });
  if (!client.enabled()) {
    return {
      draft: buildTechnicalDraft({ turnTask, turnPlan, state, evidencePack, recentMessages, caseUnderstanding: reasoningContext?.caseUnderstanding }),
      meta: {
        usedFallback: true,
        fallbackReason: 'model_disabled',
        parseOk: false,
        raw: '',
        parseAttemptCount: 0,
        parseModeTried: [],
        finalDraftSource: 'technical_fallback',
      },
    };
  }
  const useThinking = pblConfig.modelPolicy === 'prefer_thinking_all'
    || turnTask.roleType === 'teacher'
    || !!turnPlan?.openingMode
    || !!turnTask.shouldSummarize;
  const preferredModel = useThinking ? pblConfig.modelThinking : pblConfig.modelLite;
  const fallbackModel = useThinking ? pblConfig.modelLite : pblConfig.modelThinking;
  const defaults = {
    speaker: turnPlan?.replyTarget?.speaker || turnTask.targetSpeaker || '同学',
    point: turnPlan?.replyTarget?.point || turnTask.targetPoint || '当前病例核心观点',
    stance: turnPlan?.stance || '需先处理高危矛盾',
    next: turnPlan?.nextAction || '先补关键证据再推进',
    safetyNote: '基于常规临床路径/一般原则',
  };
  const parseModeTried = [];
  let parseAttemptCount = 0;
  const attachMeta = (r) => ({
    apiCallAttempted: r.apiCallAttempted,
    apiCallSucceeded: r.apiCallSucceeded,
    preferredModel: r.preferredModel,
    actualModel: r.actualModel,
    requestedModel: r.requestedModel,
    providerResolvedModel: r.providerResolvedModel,
    modelRoutingStage: r.modelRoutingStage,
    modelFallback: r.modelFallback,
    modelFallbackReason: r.modelFallbackReason,
    responseId: r.responseId,
    usage: r.usage,
  });

  const first = await client.chat({
    model: preferredModel,
    preferred_model: preferredModel,
    fallback_model: fallbackModel,
    allow_fallback: true,
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: '仅输出 RoleDraft JSON，禁止 markdown 与解释。' }],
    max_tokens: 1300,
    temperature: 0.35,
    tag: 'role_draft',
    model_routing_stage: turnPlan?.openingMode ? 'teacher_opening' : 'role_draft',
  });
  parseAttemptCount += 1;
  const firstParsed = parseRoleDraft(first.content, defaults);
  firstParsed.parseModeTried.forEach((m) => parseModeTried.push(m));
  if (firstParsed.parseOk) {
    return {
      draft: firstParsed.draft,
      meta: {
        usedFallback: false,
        fallbackReason: '',
        parseOk: true,
        raw: first.content,
        parseAttemptCount,
        parseModeTried: Array.from(new Set(parseModeTried)),
        finalDraftSource: firstParsed.source,
        apiMeta: attachMeta(first),
      },
    };
  }

  const strictPrompt = `${prompt}

再次强调：
1) 只输出一个 JSON 对象
2) 不要 markdown 代码块
3) 不要解释文字
4) 字段必须包含 replyTo/stance/reasoningBullets/questions/proposedNextStep/safetyNote
最小示例：
{"replyTo":{"speaker":"王同学","point":"低血压仅由疼痛导致"},"stance":"该结论证据不足","reasoningBullets":["血压和乳酸提示灌注问题","需排除休克或DIC"],"evidenceNeed":["乳酸复测"],"questions":["若乳酸继续升高你如何调整？"],"proposedNextStep":"先复苏并复评关键指标","safetyNote":"基于常规临床路径"}`
  const second = await client.chat({
    model: preferredModel,
    preferred_model: preferredModel,
    fallback_model: fallbackModel,
    allow_fallback: true,
    messages: [{ role: 'system', content: strictPrompt }],
    max_tokens: 1300,
    temperature: 0.2,
    tag: 'role_draft_retry',
    model_routing_stage: 'role_draft_retry',
  });
  parseAttemptCount += 1;
  const secondParsed = parseRoleDraft(second.content, defaults);
  secondParsed.parseModeTried.forEach((m) => parseModeTried.push(m));
  if (secondParsed.parseOk) {
    return {
      draft: secondParsed.draft,
      meta: {
        usedFallback: false,
        fallbackReason: '',
        parseOk: true,
        raw: second.content,
        parseAttemptCount,
        parseModeTried: Array.from(new Set(parseModeTried)),
        finalDraftSource: secondParsed.source,
        apiMeta: attachMeta(second),
      },
    };
  }

  const semiPrompt = `${prompt}

如果无法输出完整JSON，请按以下半结构化格式输出：
[replyTo.speaker]: xxx
[replyTo.point]: xxx
[stance]: xxx
[reasoning]:
- xxx
- xxx
[next]: xxx
[question]: xxx
[safety]: xxx`;
  const third = await client.chat({
    model: preferredModel,
    preferred_model: preferredModel,
    fallback_model: fallbackModel,
    allow_fallback: true,
    messages: [{ role: 'system', content: semiPrompt }],
    max_tokens: 1000,
    temperature: 0.2,
    tag: 'role_draft_semistructured',
    model_routing_stage: 'replanning',
  });
  parseAttemptCount += 1;
  const thirdParsed = parseRoleDraft(third.content, defaults);
  thirdParsed.parseModeTried.forEach((m) => parseModeTried.push(m));
  if (thirdParsed.parseOk) {
    return {
      draft: thirdParsed.draft,
      meta: {
        usedFallback: false,
        fallbackReason: '',
        parseOk: true,
        raw: third.content,
        parseAttemptCount,
        parseModeTried: Array.from(new Set(parseModeTried)),
        finalDraftSource: thirdParsed.source,
        apiMeta: attachMeta(third),
      },
    };
  }

  const technical = buildTechnicalDraft({ turnTask, turnPlan, state, evidencePack, recentMessages, caseUnderstanding: reasoningContext?.caseUnderstanding });
  return {
    draft: technical,
    meta: {
      usedFallback: true,
      fallbackReason: 'parse_failed',
      parseOk: false,
      raw: third.content || second.content || first.content || '',
      parseAttemptCount,
      parseModeTried: Array.from(new Set(parseModeTried)),
      finalDraftSource: 'technical_fallback',
      apiMeta: attachMeta(third),
    },
  };
}

module.exports = {
  generateRoleDraft,
};
