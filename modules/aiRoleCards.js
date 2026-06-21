const fs = require('fs');
const path = require('path');

function readTextSafe(filePath, fallback = '') {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return fallback;
  }
}

function buildRolePrompt(role) {
  const baseDir = path.join(process.cwd(), 'ai_roles');

  const globalRules = readTextSafe(
    path.join(baseDir, 'AI_助教团总规则.md'),
    'Medical_PBL AI 助教团总规则：AI 是课堂辅助，不是主讲教师。AI 服务失败时静默失败，不影响课堂继续。'
  );

  const roleMap = {
    teacher: 'A教授_角色技能卡.md',
    professor: 'A教授_角色技能卡.md',
    zheng: 'A教授_角色技能卡.md',
    B: 'B同学_角色技能卡.md',
    C: 'C同学_角色技能卡.md'
  };

  const fallbackMap = {
    teacher: '你是A教授，医学 PBL 课堂的引导型教师。请提出启发式问题，不要直接给标准答案。',
    professor: '你是A教授，医学 PBL 课堂的引导型教师。请提出启发式问题，不要直接给标准答案。',
    zheng: '你是A教授，医学 PBL 课堂的引导型教师。请提出启发式问题，不要直接给标准答案。',
    B: '你是B同学，一名医学生。请自然参与讨论，可质疑、可补充，语气友好。',
    C: '你是C同学，偏机制和证据型的医学生。请补充医学机制或鉴别点，不要编造文献。'
  };

  const roleKey = roleMap[role] ? role : 'teacher';
  const roleCard = readTextSafe(
    path.join(baseDir, roleMap[roleKey]),
    fallbackMap[roleKey] || fallbackMap.teacher
  );

  return [globalRules, roleCard].filter(Boolean).join('\n\n');
}

module.exports = { buildRolePrompt };
