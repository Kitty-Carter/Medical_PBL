function splitByTaggedChunks(text = '') {
  const t = String(text || '').trim();
  const parts = t.split(/\n\s*\[(\d+)\]\s*/).filter(Boolean);
  if (parts.length < 2) return [];
  const chunks = [];
  for (let i = 1; i < parts.length; i += 2) {
    const idx = Number(parts[i - 1]);
    const msg = String(parts[i] || '').trim();
    if (msg) chunks.push({ idx: Number.isFinite(idx) ? idx : chunks.length + 1, text: msg });
  }
  return chunks.sort((a, b) => a.idx - b.idx).map((x) => x.text);
}

function splitFallback(text = '', max = 3) {
  const sents = String(text || '').split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
  if (!sents.length) return [];
  if (sents.length <= max) return sents;
  return sents.slice(0, max);
}

function classify(roleKey, text, idx, total) {
  if (roleKey === 'ai_teacher') {
    if (idx === 0) return 'acknowledge';
    if (/[?？]/.test(text)) return 'question';
    if (/分工|B同学|C同学|你先/.test(text)) return 'tasking';
    return idx === 1 ? 'priority' : 'question';
  }
  if (roleKey === 'ai_student_B') {
    if (idx === 0) return 'stance';
    if (/[?？]/.test(text) || idx === total - 1) return 'question';
    return 'contradiction';
  }
  if (idx === 0) return 'supplement';
  if (/[?？]/.test(text) || idx === total - 1) return 'question';
  return 'plan';
}

function relayChunker({ roleKey, text }) {
  const limits = roleKey === 'ai_teacher' ? { min: 2, max: 4 } : { min: 1, max: 3 };
  const tagged = splitByTaggedChunks(text);
  let parts = tagged.length ? tagged : splitFallback(text, limits.max);
  if (parts.length < limits.min && parts.length > 0) {
    const raw = parts.join(' ').split(/(?<=[，,。！？!?])/).map((x) => x.trim()).filter(Boolean);
    parts = raw.slice(0, limits.min);
  }
  parts = parts.slice(0, limits.max);

  const chunks = parts.map((item, i) => ({
    chunkIndex: i + 1,
    totalChunks: parts.length,
    chunkType: classify(roleKey, item, i, parts.length),
    text: item,
    isFinalChunk: i === parts.length - 1,
    dependsOnPrev: i > 0,
  }));

  return {
    chunks,
    chunkCount: chunks.length,
    chunkTypes: chunks.map((x) => x.chunkType),
  };
}

module.exports = {
  relayChunker,
};
