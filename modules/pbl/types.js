const STAGES = [
  'information_gathering',
  'differential_diagnosis',
  'tests_and_workup',
  'treatment_plan',
  'risk_and_complications',
  'summary_and_reflection',
];

const ROLE_MAP = {
  teacher: { roleName: 'A教授', roleType: 'teacher' },
  ai_student_B: { roleName: 'B同学', roleType: 'student_critic' },
  ai_student_C: { roleName: 'C同学', roleType: 'student_evidence' },
};

function emptyCaseFacts() {
  return {
    chiefComplaint: '',
    historyPresentIllness: '',
    pastHistory: [],
    meds: [],
    allergies: [],
    vitals: {},
    physicalExam: [],
    labs: [],
    imaging: [],
  };
}

function defaultDiscussionState(sessionId, topic = '未命名病例') {
  return {
    sessionId,
    classId: '',
    topic,
    caseFacts: emptyCaseFacts(),
    learningGoals: [],
    hypotheses: [],
    unresolvedQuestions: [],
    observedErrors: [],
    keyDecisions: [],
    stage: 'information_gathering',
    turnCount: 0,
    speakerHistory: [],
    messageSummary: '',
    evidenceRefs: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

module.exports = {
  STAGES,
  ROLE_MAP,
  defaultDiscussionState,
};
