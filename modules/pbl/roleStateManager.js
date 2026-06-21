function defaultRoleMemory() {
  return {
    teacher: {
      lastStance: '',
      lastMeetingAction: '',
      commitments: [],
      pendingChallenges: [],
      revisionHistory: [],
      specialtyFocus: 'moderation',
    },
    B: {
      lastStance: '',
      commitments: [],
      pendingChallenges: [],
      revisionHistory: [],
      specialtyFocus: 'logic_critique',
    },
    C: {
      lastStance: '',
      commitments: [],
      pendingChallenges: [],
      revisionHistory: [],
      specialtyFocus: 'evidence_monitoring',
    },
  };
}

function pushUnique(arr = [], value, cap = 6) {
  const v = String(value || '').trim();
  if (!v) return arr.slice(-cap);
  const next = [...arr.filter((x) => x !== v), v];
  return next.slice(-cap);
}

function updateRoleMemory(memory, { roleType, draft, skeleton }) {
  const next = memory || defaultRoleMemory();
  if (roleType === 'teacher') {
    const m = next.teacher || defaultRoleMemory().teacher;
    next.teacher = {
      ...m,
      lastStance: draft?.stance || m.lastStance,
      lastMeetingAction: skeleton?.meetingActionType || m.lastMeetingAction,
      commitments: pushUnique(m.commitments, draft?.proposedNextStep, 5),
      pendingChallenges: pushUnique(m.pendingChallenges, skeleton?.contradictionAnchor?.text, 5),
      revisionHistory: pushUnique(m.revisionHistory, draft?.stance, 5),
    };
    return next;
  }
  if (roleType === 'student_critic') {
    const m = next.B || defaultRoleMemory().B;
    next.B = {
      ...m,
      lastStance: draft?.stance || m.lastStance,
      commitments: pushUnique(m.commitments, draft?.proposedNextStep, 5),
      pendingChallenges: pushUnique(m.pendingChallenges, skeleton?.mustInclude?.questionLine, 5),
      revisionHistory: pushUnique(m.revisionHistory, draft?.stance, 6),
    };
    return next;
  }
  const m = next.C || defaultRoleMemory().C;
  next.C = {
    ...m,
    lastStance: draft?.stance || m.lastStance,
    commitments: pushUnique(m.commitments, draft?.proposedNextStep, 5),
    pendingChallenges: pushUnique(m.pendingChallenges, skeleton?.mustInclude?.questionLine, 5),
    revisionHistory: pushUnique(m.revisionHistory, draft?.stance, 6),
  };
  return next;
}

module.exports = {
  defaultRoleMemory,
  updateRoleMemory,
};
