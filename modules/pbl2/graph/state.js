// RoomState 和相关数据结构定义

/**
 * @typedef {Object} RoomState
 * @property {string} roomCode
 * @property {string} caseId
 * @property {string} topic
 * @property {string} agendaStage - 澄清事实/鉴别诊断/检查与处置/复评与收束/总结
 * @property {Array<FactEntry>} factTimeline
 * @property {ClinicalSnapshot} currentSnapshot
 * @property {string} mainContradiction
 * @property {Array<OpenLoop>} openLoops
 * @property {Object<string, RoleMemory>} roleMemory
 * @property {Array<string>} lastSpeakers
 * @property {Array<string>} aiRecentReplies
 * @property {ActivitySignals} activitySignals
 */

/**
 * @typedef {Object} FactEntry
 * @property {number} timestamp
 * @property {string} category - vital_sign/lab/treatment/event
 * @property {string} key
 * @property {string|number} value
 * @property {string} source
 */

/**
 * @typedef {Object} ClinicalSnapshot
 * @property {Object} vitalSigns - BP, HR, RR, SpO2, T
 * @property {Object} labs - Hb, PLT, PT, APTT, FIB, D-dimer, Lactate
 * @property {Object} fluids - 尿量, 出血量
 * @property {Array<string>} riskFlags
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} RoleMemory
 * @property {string} lastStance
 * @property {Array<string>} commitments
 * @property {Array<string>} pendingChallenges
 * @property {Array<Object>} revisionHistory
 */

/**
 * @typedef {Object} ActivitySignals
 * @property {number} informativeCount
 * @property {number} noiseCount
 * @property {boolean} aiPasteSuspected
 * @property {number} lastInformativeAt
 */

/**
 * @typedef {Object} OpenLoop
 * @property {string} question
 * @property {string} category
 * @property {number} createdAt
 */

/**
 * @typedef {Object} TurnPlan
 * @property {string} roleKey
 * @property {Array<string>} speechActs
 * @property {Object} replyTarget
 * @property {Array<string>} keyFactCluster
 * @property {string} mainContradiction
 * @property {Array<string>} nextActions
 * @property {string} questionOrBranch
 * @property {string} tone
 * @property {Object} segmentSpec
 */

/**
 * @typedef {Object} Segments
 * @property {Array<Segment>} segments
 */

/**
 * @typedef {Object} Segment
 * @property {string} type
 * @property {string} text
 */

/**
 * 创建初始 RoomState
 */
function createInitialState(roomCode) {
  return {
    roomCode,
    caseId: '',
    topic: '',
    agendaStage: '澄清事实',
    factTimeline: [],
    currentSnapshot: {
      vitalSigns: {},
      labs: {},
      fluids: {},
      riskFlags: [],
      updatedAt: Date.now(),
    },
    mainContradiction: '',
    openLoops: [],
    roleMemory: {
      teacher: { lastStance: '', commitments: [], pendingChallenges: [], revisionHistory: [] },
      B: { lastStance: '', commitments: [], pendingChallenges: [], revisionHistory: [] },
      C: { lastStance: '', commitments: [], pendingChallenges: [], revisionHistory: [] },
    },
    lastSpeakers: [],
    aiRecentReplies: [],
    activitySignals: {
      informativeCount: 0,
      noiseCount: 0,
      aiPasteSuspected: false,
      lastInformativeAt: 0,
    },
  };
}

module.exports = {
  createInitialState,
};
