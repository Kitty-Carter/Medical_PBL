const { ROLE_CARDS, buildStylePrompt } = require('./promptTemplates');
const { pblConfig } = require('./config');
const { pickWithCooldown, lexicalDedupe } = require('./naturalness');

function trimSentence(s, max = 70) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function shortClinicalFact(state, turnPlan) {
  const cf = state?.caseFacts || {};
  const facts = [];
  if (cf.vitals?.BP) facts.push(`血压${cf.vitals.BP}`);
  if (cf.vitals?.HR) facts.push(`心率${cf.vitals.HR}`);
  if (cf.vitals?.SpO2) facts.push(`SpO2 ${cf.vitals.SpO2}`);
  if (cf.vitals?.T) facts.push(`体温${cf.vitals.T}`);
  (cf.labs || []).slice(0, 2).forEach((x) => facts.push(x));
  if (cf.lactate) facts.push(`乳酸${cf.lactate}`);
  if (cf.bleedingVolume) facts.push(`出血量${cf.bleedingVolume}`);
  (turnPlan?.clinicalAnchors || []).slice(0, 2).forEach((x) => facts.push(x));
  const uniq = Array.from(new Set(facts.filter(Boolean)));
  return uniq.slice(0, 2).join('、') || '当前关键生命体征与核心化验';
}

function safeReason(turnPlan, draft) {
  const r = String(turnPlan?.reasoningMove || '').trim();
  if (r) return r;
  const b = (draft?.reasoningBullets || []).find((x) => String(x || '').length < 42 && !/先回应具体观点|避免空泛复述/.test(String(x || '')));
  return b || '证据链尚不闭合';
}

function buildFromSkeleton(turnTask, skeleton) {
  if (!skeleton) return '';
  const m = skeleton.mustInclude || {};
  const base = `${m.factAnchorLine || ''}。${m.contradictionLine || ''}。${m.actionLine || ''}。${m.questionLine || ''}`.replace(/\s+/g, ' ');
  if (turnTask.roleType === 'teacher') {
    const act = skeleton.meetingActionType || 'focus_set';
    return `先定焦点：${m.factAnchorLine || '当前关键事实'}。核心矛盾是${m.contradictionLine || '路径冲突未闭环'}。我现在执行${act}：${m.actionLine || '先推进关键动作'}。请明确表态：${m.questionLine || '你优先哪条路径？'}`;
  }
  const stance = skeleton.stanceAction || 'partial_agree';
  return `我先表态：${stance}。事实是${m.factAnchorLine || '关键事实待补充'}。矛盾在于${m.contradictionLine || '推理冲突'}。我的推进动作：${m.actionLine || '先补证据'}。追问：${m.questionLine || '下一步如何分叉？'}`;
}

function renderByPlan(sessionId, turnTask, turnPlan, draft, state, evidencePack, skeleton) {
  const sText = buildFromSkeleton(turnTask, skeleton);
  if (sText) return lexicalDedupe(sText, turnPlan?.lexicalAvoid || []);
  const reply = trimSentence(turnPlan?.replyTarget?.point || draft.replyTo?.point || turnTask.targetPoint || '当前核心判断', 56);
  const anchors = shortClinicalFact(state, turnPlan);
  const reason = trimSentence(safeReason(turnPlan, draft), 48);
  const step = trimSentence(turnPlan?.nextAction || draft.proposedNextStep || '先补关键检查后再收敛结论', 40);
  const qRaw = turnPlan?.branchQuestion || (draft.questions || [])[0] || pickWithCooldown(sessionId, 'branch');
  const q = trimSentence(qRaw, 56);
  const evidenceTip = evidencePack?.evidenceInsufficient ? '我这轮基于病例事实和常规临床路径判断。' : '';
  const intent = turnPlan?.meetingIntent || 'refine';

  if (turnTask.roleType === 'teacher') {
    const open = pickWithCooldown(sessionId, 'teacher_open');
    const close = turnPlan?.agenda === '总结反思' ? `${pickWithCooldown(sessionId, 'summary_close')}当前一致的是先稳住高风险，再按证据收敛。` : '';
    let out = turnPlan?.openingMode
      ? `${open}先不急着给最终诊断，当前先按病例主轴定议程。`
      : `${open}${turnPlan?.replyTarget?.speaker || draft.replyTo?.speaker || '同学'}刚才提到“${reply}”，这个点要和${anchors}一起看。`;
    out += `我先纠偏一句：${reason}。`;
    out += `下一步先做${step}。`;
    if (intent === 'triage' || /优先级/.test(turnPlan?.agenda || '')) {
      out += `当前阶段先救命和高危排除，细化鉴别放在后一步。`;
    }
    if (turnPlan?.openingMode) {
      out += `分工：B同学先抓推理漏洞，C同学补证据链与复评节点。`;
    }
    if (q) out += `分叉追问：${q}`;
    if (evidenceTip) out += evidenceTip;
    if (close) out += close;
    return lexicalDedupe(out, turnPlan?.lexicalAvoid || []);
  }

  if (turnTask.roleType === 'student_critic') {
    const open = pickWithCooldown(sessionId, 'critic_open');
    let out = `${open}${reply}我只部分同意。`;
    out += `按${anchors}看，当前推理的短板是${reason}。`;
    out += `更稳的做法是先按${step}去证伪，再决定是否收敛。`;
    if (q) out += `我的追问是：${q}`;
    if (evidenceTip) out += evidenceTip;
    return lexicalDedupe(out, turnPlan?.lexicalAvoid || []);
  }

  const open = pickWithCooldown(sessionId, 'evidence_open');
  let out = `${open}${anchors}提示我们不能只盯单点指标。`;
  out += `我补一条证据链：${reason}。`;
  out += `可执行动作是先做${step}，并设定30-60分钟复评节点。`;
  if (q) out += `我想先确认：${q}`;
  if (evidenceTip) out += evidenceTip;
  return lexicalDedupe(out, turnPlan?.lexicalAvoid || []);
}

function structuredRender(turnTask, draft, state, evidencePack, turnPlan = {}, sessionId = 'default', skeleton) {
  return renderByPlan(sessionId, turnTask, turnPlan, draft, state, evidencePack, skeleton);
}

async function renderStyle({ client, turnTask, turnPlan, draft, evidencePack, state, recentMessages = [], sessionId = 'default', contentSkeleton }) {
  if (!client.enabled()) {
    return {
      message: renderByPlan(sessionId, turnTask, turnPlan, draft, state, evidencePack, contentSkeleton),
      meta: { usedFallback: true, fallbackReason: 'model_disabled', raw: '' },
    };
  }
  const roleCard = ROLE_CARDS[turnTask.roleType] || ROLE_CARDS.student_critic;
  const prompt = `${buildStylePrompt({ roleCard, turnTask, draft, evidencePack })}

你必须命中以下骨架要点，不得遗漏：
${JSON.stringify(contentSkeleton?.mustInclude || {}, null, 2)}
禁止高泛化句：
${JSON.stringify(contentSkeleton?.speakingConstraints?.avoidPhrases || [], null, 2)}`;
  const useThinking = pblConfig.modelPolicy === 'prefer_thinking_all' && turnTask.roleType === 'teacher';
  const preferredModel = useThinking ? pblConfig.modelThinking : pblConfig.modelLite;
  const fallbackModel = useThinking ? pblConfig.modelLite : pblConfig.modelThinking;
  const r = await client.chat({
    model: preferredModel,
    preferred_model: preferredModel,
    fallback_model: fallbackModel,
    allow_fallback: true,
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: '请输出最终对话文本。' }],
    max_tokens: 1000,
    temperature: 0.7,
    tag: 'style_render',
    model_routing_stage: 'rendering',
  });
  if (r.content) {
    const must = contentSkeleton?.mustInclude || {};
    const hits = [must.factAnchorLine, must.contradictionLine, must.actionLine, must.questionLine].filter(Boolean).filter((x) => String(r.content).includes(String(x).slice(0, 6)));
    if (hits.length < 2) {
      return {
        message: buildFromSkeleton(turnTask, contentSkeleton) || renderByPlan(sessionId, turnTask, turnPlan, draft, state, evidencePack, contentSkeleton),
        meta: { usedFallback: true, fallbackReason: 'style_skeleton_miss', raw: r.content, apiMeta: {
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
        } },
      };
    }
    return {
      message: r.content,
      meta: {
        usedFallback: false,
        fallbackReason: '',
        raw: r.content,
        apiMeta: {
          apiCallAttempted: r.apiCallAttempted,
          apiCallSucceeded: r.apiCallSucceeded,
          preferredModel: r.preferredModel,
          actualModel: r.actualModel,
          modelFallback: r.modelFallback,
          modelFallbackReason: r.modelFallbackReason,
          responseId: r.responseId,
          usage: r.usage,
        },
      },
    };
  }
  return {
    message: renderByPlan(sessionId, turnTask, turnPlan, draft, state, evidencePack, contentSkeleton),
    meta: { usedFallback: true, fallbackReason: 'style_empty', raw: '' },
  };
}

module.exports = {
  renderStyle,
  structuredRender,
};
