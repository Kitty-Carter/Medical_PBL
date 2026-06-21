// 上下文组织器 - 纪要化+裁剪（省 token）
const config = require('../config/config');

/**
 * 构建 ContextPack（纪要化上下文）
 * 禁止：每轮塞病例全文、完整 transcript
 */
function buildContextPack(state, room, roleKey, eventType) {
  const {
    agendaStage = 'exploring',
    keyFacts = [],
    mainContradiction = '',
    openLoops = [],
    transcript = [],
    lessonMemory = {},
  } = state;

  // 提取病例实体（核心！）
  const { extractCaseEntities } = require('./caseEntityExtractor');
  const caseEntities = extractCaseEntities(room, state);

  // 1. 关键事实聚类（优先使用 caseEntities）
  const keyFactCluster = caseEntities.allKeywords.length > 0 
    ? caseEntities.allKeywords.slice(0, 6).map(k => `- ${k}`).join('\n')
    : keyFacts.slice(-config.context.keyFactsMax).map(f => `- ${f.fact} (${f.source || '已知'})`).join('\n');

  // 2. 主矛盾（1条）
  const mainContradictionText = mainContradiction || '尚未明确主矛盾';

  // 3. 未闭环问题（1~3条）
  const openLoopsText = openLoops
    .slice(0, config.context.openLoopsMax)
    .map((loop, i) => `${i + 1}. ${loop.question || loop}`)
    .join('\n');

  // 4. 最近对话摘录（最近10~15条，裁剪到2000字）
  const recentMessages = transcript.slice(-config.context.recentMessagesCount);
  let recentExcerpts = recentMessages
    .map(msg => `[${msg.speaker || msg.roleKey}] ${msg.text || msg.content}`)
    .join('\n');
  
  if (recentExcerpts.length > config.context.maxRecentChars) {
    recentExcerpts = recentExcerpts.slice(-config.context.maxRecentChars) + '\n...(已裁剪)';
  }

  // 5. 课堂记忆要点（可选，<=6条，<=400字）
  const lessonMemoryBullets = lessonMemory.bullets
    ? lessonMemory.bullets
        .slice(0, config.context.lessonMemoryBullets)
        .map(b => `- ${b}`)
        .join('\n')
    : '';

  // 6. 是否需要附加 few-shot（只在关键事件）
  const needsFewShot = shouldAttachFewShot(eventType, state);

  // 组装 ContextPack
  const contextPack = {
    agendaStage,
    keyFactCluster,
    mainContradiction: mainContradictionText,
    openLoops: openLoopsText || '暂无未闭环问题',
    recentExcerpts,
    lessonMemoryBullets,
    needsFewShot,
    eventType,
    caseEntities, // 新增：传递病例实体
  };

  return formatContextPackForPrompt(contextPack);
}

/**
 * 判断是否需要附加 few-shot / 长人设
 */
function shouldAttachFewShot(eventType, state) {
  const triggers = [
    'teacher_opening',          // 新病例开场
    'ai_paste_suspected',       // 长文消化
    'teacher_summary',          // 阶段总结
  ];
  
  // 或者输出质量差被重写
  if (state.lastOutputQuality && state.lastOutputQuality < 3) {
    return true;
  }
  
  return triggers.includes(eventType);
}

/**
 * 格式化为提示词
 */
function formatContextPackForPrompt(pack) {
  // 添加病例关键词提示（强制相关性）
  const caseKeywordsHint = pack.caseEntities && pack.caseEntities.allKeywords.length > 0
    ? `\n【病例关键词（必须使用）】\n${pack.caseEntities.allKeywords.slice(0, 8).join('、')}\n`
    : '';
  
  const quoteSnippetHint = pack.caseEntities && pack.caseEntities.quoteSnippets.length > 0
    ? `\n【可引用原文片段】\n"${pack.caseEntities.quoteSnippets[0]}"\n`
    : '';

  return `【课堂状态】
阶段：${pack.agendaStage}

【关键事实】
${pack.keyFactCluster || '尚无关键事实'}

【主矛盾】
${pack.mainContradiction}

【未闭环问题】
${pack.openLoops}

${pack.lessonMemoryBullets ? `【课堂记忆】\n${pack.lessonMemoryBullets}\n` : ''}

${caseKeywordsHint}

${quoteSnippetHint}

【最近对话】
${pack.recentExcerpts}

【重要约束】
1. 输出必须包含至少2个病例关键词（见上方列表）
2. 如果当前角色是 teacher，第一段必须引用病例原文（8-20字）
3. 如果当前角色是 B 或 C，也必须明确绑定病例事实或数值
4. 禁止使用未在病例中出现的症状（如腹痛、呕吐、便血等）`;
}

/**
 * 构建完整 messages 数组
 */
function buildMessages(state, room, roleKey, eventType, additionalContext = '') {
  const { systemPrompt, outputProtocol, roleCards } = require('./roleCards');
  
  const contextPack = buildContextPack(state, room, roleKey, eventType);
  
  // 选择角色卡
  const roleCard = roleCards[roleKey] || roleCards.teacher;
  
  // 合并所有 system 内容到一个消息（DeepSeek 不支持 developer 角色）
  const combinedSystem = `${systemPrompt}

【输出协议】
${outputProtocol}

【本轮角色规则】
${roleCard}`;
  
  const messages = [
    { role: 'system', content: combinedSystem },
    { role: 'user', content: contextPack + (additionalContext ? `\n\n${additionalContext}` : '') },
  ];
  
  return messages;
}

module.exports = {
  buildContextPack,
  buildMessages,
  shouldAttachFewShot,
};
