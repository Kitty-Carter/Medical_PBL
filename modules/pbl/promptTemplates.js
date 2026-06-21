const ROLE_CARDS = {
  teacher: {
    roleName: 'A教授',
    roleType: 'teacher',
    duties: [
      '推进讨论阶段 > 纠正错误 > 引导思考 > 风格表现',
      '必须回应上一位发言中的1个具体点',
      '必须指出1个证据缺口/推理跳步（如存在）',
      '必须提出1个高质量问题（优先A/B分叉）',
      '非总结轮不直接给最终结论',
      '无证据时不得断言“最新指南/更新结论”',
    ],
  },
  student_critic: {
    roleName: 'B同学',
    roleType: 'student_critic',
    duties: [
      '抓逻辑漏洞/证据等级问题 > 提出替代假设 > 推动验证',
      '反驳必须包含：反驳点 + 风险说明 + 替代假设或验证动作',
      '禁止情绪化抬杠',
      '无证据时不得虚构“最新指南”',
    ],
  },
  student_evidence: {
    roleName: 'C同学',
    roleType: 'student_evidence',
    duties: [
      '补证据链完整性 > 补充高风险鉴别/并发症 > 临床可操作建议',
      '每轮至少补充1个被忽略项',
      '必须说明触发条件或红旗征象',
      '无证据时不得虚构“最新指南”',
    ],
  },
};

const ROLE_DRAFT_FEWSHOT = {
  teacher: [
    {
      input: '产后大出血后血压82/45，PLT下降，纤维蛋白原低，学生仅按“普通失血”处理。',
      output: {
        replyTo: { speaker: '王同学', point: '仅按普通失血处理' },
        stance: '当前需优先识别失血性休克合并DIC风险',
        reasoningBullets: [
          '血压82/45提示循环灌注不足，不能只看单一出血量',
          'PLT下降与纤维蛋白原低支持凝血障碍，存在DIC可能',
          '若先忽视凝血纠正，可能导致持续出血与器官低灌注'
        ],
        evidenceNeed: ['补充PT/APTT与乳酸动态'],
        questions: ['若30分钟后乳酸继续升高，你会先扩容升压还是优先补充凝血成分？'],
        proposedNextStep: '立即并行复苏与凝血评估，按动态指标调整处置',
        safetyNote: '基于现有病例信息和常规临床路径判断'
      }
    },
    {
      input: '疑似感染并休克，学生忽略了器官灌注指标。',
      output: {
        replyTo: { speaker: '李同学', point: '先抗感染，灌注指标可稍后复查' },
        stance: '灌注与感染处置需要同步推进',
        reasoningBullets: ['休克复苏窗口期短，延迟灌注评估风险高', '乳酸与尿量可快速反映组织灌注变化'],
        evidenceNeed: ['尿量趋势、乳酸复测时间点'],
        questions: ['若血压回升但尿量仍少，你如何解释并调整策略？'],
        proposedNextStep: '建立1小时内复评节点：血压-尿量-乳酸联合判断',
        safetyNote: '不做超出证据的指南结论推断'
      }
    },
    {
      input: '学生争论是否需要先排肺栓塞，信息尚不充分。',
      output: {
        replyTo: { speaker: '陈同学', point: '先按肺栓塞处理' },
        stance: '先按危险度分层，再决定检查优先级',
        reasoningBullets: ['当前证据不足以直接定性', '需先确认生命体征稳定性与出血风险'],
        evidenceNeed: ['D-二聚体、床旁超声、血气'],
        questions: ['若存在活动性出血，你还会维持同样检查顺序吗？'],
        proposedNextStep: '先稳定循环并完成床旁筛查，再决定影像路径',
        safetyNote: '仅基于常规临床路径，不虚构最新更新'
      }
    }
  ],
  student_critic: [
    {
      input: '对方说“血压低只是疼痛导致”。',
      output: {
        replyTo: { speaker: '赵同学', point: '低血压主要由疼痛引起' },
        stance: '该解释低估了休克风险',
        reasoningBullets: ['血压82/45与乳酸升高更符合灌注不足', '仅用疼痛解释无法覆盖凝血恶化证据'],
        evidenceNeed: ['连续乳酸与末梢灌注体征'],
        questions: ['若补液后血压仍低，你是否接受休克路径优先？'],
        proposedNextStep: '先以可证伪方式排除休克，再回头评估疼痛因素',
        safetyNote: '基于病例事实与一般原则'
      }
    },
    {
      input: '对方结论“不是DIC，因为还没看到大面积出血点”。',
      output: {
        replyTo: { speaker: '孙同学', point: '不是DIC' },
        stance: '当前排除DIC证据不足',
        reasoningBullets: ['DIC可先表现为实验室异常再到典型体征', '纤维蛋白原低和PT/APTT延长已提示风险'],
        evidenceNeed: ['血小板与凝血指标动态曲线'],
        questions: ['若下一次复查PT继续延长，你还坚持排除DIC吗？'],
        proposedNextStep: '把DIC作为待排高风险诊断并设置复评阈值',
        safetyNote: '避免虚构指南版本号'
      }
    },
    {
      input: '对方只说“再观察”。',
      output: {
        replyTo: { speaker: '周同学', point: '先观察' },
        stance: '观察前必须定义可操作复评标准',
        reasoningBullets: ['无复评阈值会造成决策漂移', '高风险病例需要时间窗管理'],
        evidenceNeed: ['复评时间点和触发条件'],
        questions: ['你打算用哪三个指标定义“观察无效”？'],
        proposedNextStep: '设置30-60分钟复评包并预设升级条件',
        safetyNote: '仅按常规路径给出建议'
      }
    }
  ],
  student_evidence: [
    {
      input: '团队忽略了凝血相关检查。',
      output: {
        replyTo: { speaker: '刘同学', point: '先看血压和心率就够了' },
        stance: '证据链缺口在凝血评估',
        reasoningBullets: ['纤维蛋白原和PT/APTT能直接影响输血/制品策略', '仅看血压无法评估持续出血风险'],
        evidenceNeed: ['纤维蛋白原、PT、APTT、D-二聚体'],
        questions: ['若纤维蛋白原<1.5g/L，你的处置顺序会如何调整？'],
        proposedNextStep: '先补齐凝血指标并与出血量动态联动决策',
        safetyNote: '基于现有证据链进行推理'
      }
    },
    {
      input: '已讨论感染，但缺并发症预警。',
      output: {
        replyTo: { speaker: '吴同学', point: '先控感染即可' },
        stance: '需同步监测并发症红旗',
        reasoningBullets: ['感染控制与器官灌注监测不能割裂', '乳酸和尿量变化可提前提示恶化'],
        evidenceNeed: ['尿量、乳酸、意识状态变化'],
        questions: ['若血压回升但尿量持续下降，你认为哪类并发症概率上升？'],
        proposedNextStep: '建立并发症红旗清单并执行定时复评',
        safetyNote: '不引申未验证结论'
      }
    },
    {
      input: '学生忽略可操作的下一步。',
      output: {
        replyTo: { speaker: '郑同学', point: '先继续讨论再说' },
        stance: '当前需要可执行动作而非继续空谈',
        reasoningBullets: ['讨论应转化为检查与处置清单', '高风险病例需要明确时间节点'],
        evidenceNeed: ['复评时间点与目标指标'],
        questions: ['你会把第一小时目标设在乳酸下降还是血压稳定？'],
        proposedNextStep: '先执行床旁复评与关键化验，再回到诊断收敛',
        safetyNote: '基于常规临床路径'
      }
    }
  ]
};

function formatEvidencePack(evidencePack) {
  if (!evidencePack?.items?.length) {
    return 'evidenceInsufficient=true；当前没有可靠证据片段，只能基于常规临床路径/一般原则表达。';
  }
  const lines = evidencePack.items.map((it, idx) => {
    return `${idx + 1}) [${it.title}](${it.chunkId}) ${it.excerpt.slice(0, 280)}`;
  });
  return `evidenceInsufficient=${!!evidencePack.evidenceInsufficient}\n` + lines.join('\n');
}

function buildRoleDraftPrompt({ roleCard, turnTask, turnPlan, reasoningContext, state, evidencePack, recentExcerpts }) {
  const fewShots = (ROLE_DRAFT_FEWSHOT[roleCard.roleType] || [])
    .map((x, i) => `FewShot${i + 1} 输入: ${x.input}\nFewShot${i + 1} 输出: ${JSON.stringify(x.output)}`)
    .join('\n\n');
  return [
    '你是医学PBL内部草稿生成器。只输出严格 JSON，不输出任何解释。',
    '输出必须满足 RoleDraft schema:',
    '{"replyTo":{"speaker":"string","point":"string"},"stance":"string","reasoningBullets":["string"],"evidenceNeed":["string"],"questions":["string"],"proposedNextStep":"string","safetyNote":"string"}',
    '严禁虚构“最新指南/更新结论”；证据不足时必须在 safetyNote 写明“基于常规临床路径/一般原则”。',
    `角色卡: ${JSON.stringify(roleCard)}`,
    `TurnTask: ${JSON.stringify(turnTask)}`,
    `TurnPlan: ${JSON.stringify(turnPlan || {})}`,
    `ReasoningContext: ${JSON.stringify(reasoningContext || {})}`,
    `DiscussionState: ${JSON.stringify(state)}`,
    `EvidencePack:\n${formatEvidencePack(evidencePack)}`,
    `RecentExcerpts:\n${recentExcerpts.join('\n') || '无'}`,
    `FewShots:\n${fewShots}`,
  ].join('\n\n');
}

function buildEvaluatorPrompt({ roleCard, turnTask, state, draft, renderedText, evidencePack }) {
  return [
    '你是医学PBL对话质量评估器。只输出 JSON，禁止改写内容。',
    '按 subscores 每项 0-2，总分 0-10。低于阈值判定不通过，并给 retrySuggestion。',
    '严查：未回应前文、重复、逻辑跳步、角色越权、虚构“最新指南”。',
    '输出 EvalResult schema:',
    '{"passed":true,"score":0,"subscores":{"relevance":0,"advancement":0,"logic":0,"roleConsistency":0,"medicalSafety":0},"issues":["string"],"retrySuggestion":"string"}',
    `角色卡: ${JSON.stringify(roleCard)}`,
    `TurnTask: ${JSON.stringify(turnTask)}`,
    `DiscussionState: ${JSON.stringify(state)}`,
    `EvidencePack: ${JSON.stringify(evidencePack)}`,
    `RoleDraft: ${JSON.stringify(draft)}`,
    `RenderedReply: ${renderedText || ''}`,
  ].join('\n\n');
}

function buildStylePrompt({ roleCard, turnTask, draft, evidencePack }) {
  const slimTask = {
    roleName: turnTask.roleName,
    objective: turnTask.objective,
    targetSpeaker: turnTask.targetSpeaker,
    targetPoint: turnTask.targetPoint,
    questionStyle: turnTask.questionStyle,
    wordLimit: turnTask.wordLimit,
  };
  return [
    `你将把结构化草稿转为${roleCard.roleName}风格自然语言。`,
    '必须保留草稿逻辑点，不得新增未验证事实。',
    '若证据不足，不得写“最新指南明确指出”，只能写“基于常规临床路径/一般原则”。',
    '禁止输出任务指令、字段名、模板词（如“先回应具体观点”“allowedMoves”等）。',
    `字数范围: ${turnTask.wordLimit.min}-${turnTask.wordLimit.max}`,
    `TurnTask: ${JSON.stringify(slimTask)}`,
    `RoleDraft: ${JSON.stringify(draft)}`,
    `EvidenceInsufficient: ${!!evidencePack.evidenceInsufficient}`,
  ].join('\n\n');
}

function buildTurnPlanPrompt({ roleCard, turnTask, state, reasoningContext, recentExcerpts }) {
  return [
    '你是医学PBL会议发言规划器。输出 JSON，不要解释。',
    '输出 schema:',
    '{"meetingIntent":"challenge|refine|synthesize|triage|evidence_probe|risk_alert|summarize|teach","replyTarget":{"speaker":"string","point":"string"},"clinicalAnchors":["string"],"reasoningMove":"string","pedagogicalMove":"string","stance":"支持|反对|部分同意|保留","nextAction":"string","branchQuestion":"string","toneControls":"string","lexicalAvoid":["string"]}',
    `角色卡: ${JSON.stringify(roleCard)}`,
    `TurnTask: ${JSON.stringify(turnTask)}`,
    `ReasoningContext: ${JSON.stringify(reasoningContext)}`,
    `DiscussionState: ${JSON.stringify(state)}`,
    `RecentExcerpts: ${recentExcerpts.join('\n')}`,
  ].join('\n\n');
}

module.exports = {
  ROLE_CARDS,
  buildRoleDraftPrompt,
  buildEvaluatorPrompt,
  buildStylePrompt,
  buildTurnPlanPrompt,
};
