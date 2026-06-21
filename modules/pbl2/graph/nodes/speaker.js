// 节点4: decide_next_speaker - 事件驱动的发言人选择
function decideNextSpeaker(graphState) {
  const { state, ingestResult, room, opts = {} } = graphState;
  const messages = room.messages || [];
  const preferredRole = normalizePreferredRole(opts.preferredRole);

  if (preferredRole) {
    return { nextSpeaker: preferredRole, reason: opts.triggerReason || 'preferred_role' };
  }

  // 新病例开场
  if (messages.length <= 1 && ingestResult.latestMessage?.content?.includes('开始')) {
    return { nextSpeaker: 'teacher', reason: 'teacher_opening' };
  }

  // AI长文粘贴 => teacher digest
  if (ingestResult.aiPasteSuspected) {
    return { nextSpeaker: 'teacher', reason: 'ai_paste_suspected' };
  }

  // 危重信号 => teacher
  if (state.currentSnapshot && state.currentSnapshot.riskFlags && state.currentSnapshot.riskFlags.length > 0) {
    const lastSpeaker = state.lastSpeakers && state.lastSpeakers[state.lastSpeakers.length - 1];
    if (lastSpeaker !== 'teacher') {
      return { nextSpeaker: 'teacher', reason: 'red_flag' };
    }
  }

  // 噪声累积 => teacher
  if (state.activitySignals && state.activitySignals.noiseCount >= 2) {
    state.activitySignals.noiseCount = 0;
    return { nextSpeaker: 'teacher', reason: 'noise_redirect' };
  }

  // 学生刚提观点 => B/C 跟进（轮换）
  if (ingestResult.senderRole === 'student' && ingestResult.contentLength > 50) {
    const lastAiSpeaker = (state.lastSpeakers || []).filter(s => s === 'B' || s === 'C').pop();
    const nextStudent = lastAiSpeaker === 'B' ? 'C' : 'B';
    return { nextSpeaker: nextStudent, reason: 'student_follow_up' };
  }

  // 每6~10个回合 => teacher阶段总结
  const turnCount = (state.lastSpeakers || []).length;
  if (turnCount > 0 && turnCount % 8 === 0) {
    return { nextSpeaker: 'teacher', reason: 'teacher_summary' };
  }

  // 默认轮换
  const lastSpeaker = (state.lastSpeakers || [])[state.lastSpeakers.length - 1];
  if (lastSpeaker === 'teacher') {
    return { nextSpeaker: 'B', reason: 'rotation' };
  } else if (lastSpeaker === 'B') {
    return { nextSpeaker: 'C', reason: 'rotation' };
  } else {
    return { nextSpeaker: 'teacher', reason: 'rotation' };
  }
}

function normalizePreferredRole(role) {
  const normalized = String(role || '').trim();
  if (!normalized) return '';
  if (normalized === 'teacher' || normalized === 'ai_teacher') return 'teacher';
  if (normalized === 'B' || normalized === 'ai_student_B') return 'B';
  if (normalized === 'C' || normalized === 'ai_student_C') return 'C';
  return '';
}

module.exports = { decideNextSpeaker };
