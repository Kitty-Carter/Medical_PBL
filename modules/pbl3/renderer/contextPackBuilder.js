/**
 * ContextPack 构建器（纪要化上下文）
 * 禁止：每轮塞病例全文、完整transcript
 */

/**
 * 构建纪要化上下文
 */
function buildContextPack(room, event, policy) {
  const { state = {} } = room;
  const {
    agendaStage = 'exploring',
    keyFacts = [],
    mainContradiction = '',
    openLoops = [],
    transcript = []
  } = state;
  
  const { entities } = event;
  
  // 1. 关键事实聚类（最近6条 or 从entities提取）
  let keyFactCluster = '';
  if (keyFacts.length > 0) {
    keyFactCluster = keyFacts.slice(-6)
      .map(f => `- ${f.fact || f}`)
      .join('\n');
  } else if (entities.allKeywords.length > 0) {
    keyFactCluster = entities.allKeywords.slice(0, 6)
      .map(k => `- ${k}`)
      .join('\n');
  }
  
  // 2. 主矛盾（1条）
  const mainContradictionText = mainContradiction || 
    (entities.allKeywords.length >= 2 
      ? `${entities.allKeywords[0]}与${entities.allKeywords[1]}之间的关系` 
      : '尚未明确');
  
  // 3. 未闭环问题（最多3条）
  const openLoopsText = openLoops.length > 0
    ? openLoops.slice(0, 3).map((loop, i) => `${i + 1}. ${loop.question || loop}`).join('\n')
    : '暂无';
  
  // 4. 最近对话摘录（最近10条，裁剪到1500字）
  const recentMessages = transcript.slice(-10);
  let recentExcerpts = recentMessages
    .map(msg => `[${msg.speaker || msg.roleKey}] ${msg.text || msg.content}`)
    .join('\n');
  
  if (recentExcerpts.length > 1500) {
    recentExcerpts = recentExcerpts.slice(-1500) + '\n...(已裁剪)';
  }
  
  // 5. 病例关键词提示（必须使用）
  const caseKeywordsHint = policy.keyEntities && policy.keyEntities.length > 0
    ? `\n【病例关键词（必须使用）】\n${policy.keyEntities.slice(0, 6).join('、')}\n`
    : '';
  
  // 6. 可引用原文片段
  const quoteSnippetHint = policy.quoteSnippet
    ? `\n【必须引用原文】\n"${policy.quoteSnippet}"\n第一段必须包含此引用（或其中8-20字片段）\n`
    : '';
  
  const contextPack = `【课堂状态】
阶段：${agendaStage}

【关键事实】
${keyFactCluster || '尚无'}

【主矛盾】
${mainContradictionText}

【未闭环问题】
${openLoopsText}

${caseKeywordsHint}

${quoteSnippetHint}

【最近对话】
${recentExcerpts || '暂无'}

【重要约束】
1. 输出必须包含至少2个病例关键词（见上方列表）
2. 第一段必须引用病例原文（8-20字）
3. 禁止提及病例中不存在的症状（如腹痛、呕吐、便血等）
4. 每段50-120字，最多180字
5. 禁止元话术（如"目前处于澄清事实阶段"）`;

  console.log(`[ContextPack] 长度=${contextPack.length}字`);
  
  return contextPack;
}

module.exports = {
  buildContextPack
};
