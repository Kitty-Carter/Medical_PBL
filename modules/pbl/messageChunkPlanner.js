function cutByPunctuation(text = '') {
  return String(text || '')
    .split(/(?<=[。！？!?])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function classifyPart(part, idx, total, roleKey) {
  if (idx === 0) {
    if (roleKey === 'ai_teacher' && /肯定|认可|这点/.test(part)) return 'acknowledge';
    if (roleKey === 'ai_teacher' && /优先|纠偏|关键/.test(part)) return 'priority_correction';
    if (roleKey === 'ai_teacher') return 'opening';
    if (roleKey === 'ai_student_B' && /反对|不同意|部分/.test(part)) return 'stance';
    if (roleKey === 'ai_student_B') return 'opening';
    if (roleKey === 'ai_student_C') return 'supplement';
    return 'opening';
  }
  if (/[?？]/.test(part)) return roleKey === 'ai_teacher' ? 'branch_question' : 'challenge_question';
  if (/分工|请.*同学|你先|你们先|B同学|C同学/.test(part)) return 'tasking';
  if (/矛盾|冲突|不一致|分叉|如果/.test(part)) return 'analysis';
  if (/补|补充|另外|还有/.test(part) && roleKey === 'ai_student_C') return 'evidence_chain';
  if (idx === total - 1) return 'mini_summary';
  return idx === 1 ? 'focus' : 'analysis';
}

function capLen(part, max = 180) {
  if (part.length <= max) return [part];
  const out = [];
  let rest = part;
  while (rest.length > max) {
    out.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  if (rest) out.push(rest);
  return out;
}

function planChunks({ roleKey, finalText, contentSkeleton, chunkPolicy = {} }) {
  const raw = cutByPunctuation(finalText);
  const expanded = raw.flatMap((x) => capLen(x, chunkPolicy.maxLen || 150));
  const sc = contentSkeleton?.speakingConstraints || {};
  const minChunks = chunkPolicy.minChunks ?? (roleKey === 'ai_teacher' ? 2 : 1);
  const maxChunks = chunkPolicy.maxChunks ?? (roleKey === 'ai_teacher' ? 4 : 3);
  const desired = Math.min(maxChunks, Math.max(minChunks, Math.min(expanded.length, maxChunks)));
  const picked = expanded.slice(0, desired);
  const chunks = picked.map((text, i) => ({
    chunkId: `${Date.now()}_${i + 1}`,
    chunkIndex: i + 1,
    totalChunks: picked.length,
    chunkType: classifyPart(text, i, picked.length, roleKey),
    text,
    dependsOnPrev: i > 0,
    isFinalChunk: i === picked.length - 1,
  }));
  return {
    chunks,
    chunkCount: chunks.length,
    chunkTypes: chunks.map((c) => c.chunkType),
    chunkingReason: roleKey === 'ai_teacher' ? 'teacher_moderation_2_4' : 'student_argument_1_3',
    chunkedSendEnabled: true,
  };
}

module.exports = {
  planChunks,
};
