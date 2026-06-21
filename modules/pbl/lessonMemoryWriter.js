const fs = require('fs').promises;
const path = require('path');
const { pblConfig } = require('./config');
const { buildEvidenceIndex } = require('./evidence/indexBuilder');

function todayDirName() {
  return new Date().toISOString().slice(0, 10);
}

function toSafeText(v) {
  return String(v || '').replace(/[<>]/g, '').trim();
}

function buildLessonSummary(state, room, evidencePack) {
  const textMsgs = (room.messages || []).filter((m) => m.type === 'text');
  const highQualityTurns = textMsgs.slice(-6).map((m) => ({
    speaker: m.sender?.name || m.userName || '未知',
    content: String(m.content || '').slice(0, 220),
    whyGood: '与当前阶段相关并提供下一步动作',
  }));
  return {
    sessionId: state.sessionId,
    classId: state.classId || '',
    topic: toSafeText(state.topic),
    timestamp: new Date().toISOString(),
    keyCaseFacts: state.caseFacts,
    finalStage: state.stage,
    keyDifferentials: state.hypotheses.filter((h) => h.status === 'active' || h.status === 'supported').map((h) => h.name),
    ruledOutDifferentials: state.hypotheses.filter((h) => h.status === 'ruled_out').map((h) => h.name),
    criticalQuestionsAsked: state.unresolvedQuestions.slice(0, 12),
    commonMistakes: state.observedErrors.slice(0, 12),
    highQualityTurns,
    followUpQuestions: state.unresolvedQuestions.slice(0, 10),
    retrievalKeywords: [state.topic, ...state.hypotheses.map((h) => h.name)].filter(Boolean).slice(0, 18),
    evidenceUsed: (evidencePack?.items || []).map((x) => ({ source: x.source, title: x.title, chunkId: x.chunkId })),
  };
}

function lessonSummaryToMarkdown(summary) {
  const j = JSON.stringify(summary.keyCaseFacts || {}, null, 2);
  const list = (arr) => (arr && arr.length ? arr.map((x) => `- ${x}`).join('\n') : '- （无）');
  const hq = (summary.highQualityTurns || [])
    .map((t) => `- **${t.speaker}**: ${t.content}\n  - 评价：${t.whyGood}`)
    .join('\n');
  return [
    `# 课堂总结 - ${summary.topic || '未命名病例'}`,
    '',
    `- sessionId: ${summary.sessionId}`,
    `- 时间: ${summary.timestamp}`,
    `- 最终阶段: ${summary.finalStage}`,
    '',
    '## 病例关键事实',
    '```json',
    j,
    '```',
    '',
    '## 关键鉴别诊断',
    list(summary.keyDifferentials),
    '',
    '## 常见误区',
    list(summary.commonMistakes),
    '',
    '## 高质量问答片段',
    hq || '- （无）',
    '',
    '## 下次讨论建议切入点',
    list(summary.followUpQuestions),
    '',
    '## 可复用提示词/提醒',
    '- 先回应具体观点，再补证据缺口，再给下一步动作。',
    '- 无充分证据时仅可用“常规临床路径/一般原则”措辞。',
  ].join('\n');
}

async function writeLessonMemory({ state, room, evidencePack }) {
  const summary = buildLessonSummary(state, room, evidencePack);
  const dir = path.join(pblConfig.lessonSummaryDir, todayDirName());
  await fs.mkdir(dir, { recursive: true });
  const base = `lesson_${state.sessionId}`;
  const jsonPath = path.join(dir, `${base}.json`);
  const mdPath = path.join(dir, `${base}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(mdPath, lessonSummaryToMarkdown(summary), 'utf8');
  await buildEvidenceIndex({ force: false });
  return { jsonPath, mdPath, summary };
}

module.exports = {
  writeLessonMemory,
};
