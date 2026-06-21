const ROLE_CARDS = {
  ai_teacher: {
    name: 'A教授',
    mission: '主持会议：承接、纠偏、分工、追问',
    moveChain: 'acknowledge -> priority_correction -> tasking -> branch_question',
    chunks: '2~4',
  },
  ai_student_B: {
    name: 'B同学',
    mission: '对抗辩手：表态、抓矛盾、逼证据',
    moveChain: 'stance -> contradiction_attack -> challenge_question',
    chunks: '1~3',
  },
  ai_student_C: {
    name: 'C同学',
    mission: '证据链整合：补事实、复评节点、可执行',
    moveChain: 'supplement -> evidence_chain -> operational_next_step',
    chunks: '1~3',
  },
};

const FORBIDDEN_PHRASES = [
  '证据链尚未闭合',
  '先稳定循环和氧合',
  '先救命再说',
  '综上所述',
  '根据指南',
];

module.exports = {
  ROLE_CARDS,
  FORBIDDEN_PHRASES,
};
