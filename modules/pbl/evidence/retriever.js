const { readEvidenceIndex } = require('./indexBuilder');
const { pblConfig } = require('../config');

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z]{2,}|[一-龥]{2,8}/g) || [];
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function scoreChunk(chunk, queryTokens) {
  const tokenSet = new Set(chunk.keywords || []);
  let score = 0;
  for (const t of queryTokens) {
    if (tokenSet.has(t)) score += 2;
    if ((chunk.title || '').toLowerCase().includes(t)) score += 1.5;
    if ((chunk.content || '').toLowerCase().includes(t)) score += 0.4;
  }
  if (chunk.reliability === 'lesson_summary') score += 1.2;
  if (chunk.source.includes('lesson_summaries')) score += 0.8;
  return score;
}

function buildQuery(state) {
  const base = [
    state.topic,
    state.caseFacts?.chiefComplaint,
    ...(state.hypotheses || []).filter((h) => h.status === 'active').map((h) => h.name),
    ...(state.unresolvedQuestions || []),
    state.stage,
  ].join('\n');
  return uniq(tokenize(base));
}

async function retrieveEvidence(state, options = {}) {
  const topK = options.topK || pblConfig.evidenceTopK;
  const idx = await readEvidenceIndex();
  const queryTokens = buildQuery(state);
  const scored = (idx.chunks || [])
    .map((c) => ({ c, score: scoreChunk(c, queryTokens) }))
    .filter((x) => x.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, topK));

  const items = scored.slice(0, topK).map(({ c, score }) => ({
    source: `databases/${c.source}`,
    title: c.title,
    chunkId: c.chunkId,
    excerpt: String(c.excerpt || '').slice(0, 500),
    reliability: c.reliability || 'unknown',
    score: Number(score.toFixed(3)),
    notes: c.reliability === 'lesson_summary'
      ? '可能为内部教学总结，需结合原始指南'
      : undefined,
  }));

  return {
    evidenceInsufficient: items.length === 0,
    items,
  };
}

module.exports = {
  retrieveEvidence,
};
