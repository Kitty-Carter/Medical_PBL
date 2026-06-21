const { nextTurn, clearState } = require('../modules/pbl/orchestrator');

function mkRoom(code, firstMsg) {
  return {
    roomCode: code,
    messages: [{ type: 'text', content: firstMsg, sender: { name: '学生A', role: 'student' }, time: Date.now() }],
    aiRecentReplies: [],
  };
}

const CASES = [
  {
    key: 'ob_dIC',
    title: '产科危重-DIC',
    first: '产妇产后出血约1800mL，血压82/45mmHg，HR128，SpO2 91%，Hb 62g/L，PLT 58，PT 22s，APTT 65s，纤维蛋白原1.0g/L，乳酸4.8。学生认为先按普通失血处理。',
    inject: [
      '我觉得暂时不考虑DIC，先补液观察。',
      '补液后血压仍低，阴道持续渗血。',
    ],
  },
  {
    key: 'chest_pain',
    title: '胸痛鉴别-ACS/夹层/PE',
    first: '56岁男性突发胸痛2小时，向背部放射，出冷汗，血压90/60，心率112，D-二聚体升高，肌钙蛋白轻度升高，学生倾向直接按ACS处理。',
    inject: [
      '他也许只是心梗，不用考虑夹层。',
      '床旁超声提示主动脉根部可疑改变。',
    ],
  },
  {
    key: 'non_emergent_fever_anemia',
    title: '非急危重-长期发热合并贫血',
    first: '27岁女性反复发热1个月，体温37.8-38.6℃波动，Hb 86g/L，ESR升高，CRP中度升高，胸片无明显异常，学生认为就是普通病毒感染。',
    inject: [
      '既然胸片正常，应该不用再查太多。',
      '血培养阴性但发热持续，夜间盗汗明显。',
    ],
  },
  {
    key: 'septic_shock',
    title: '感染性休克',
    first: '老年患者发热寒战后意识模糊，血压78/42，乳酸5.2，尿量减少，疑似感染性休克。',
    inject: ['先等培养结果再说。'],
  },
  {
    key: 'stroke_window',
    title: '卒中时间窗',
    first: '患者突发右侧肢体无力和言语不清1.5小时，血压190/110，家属不确定既往抗凝情况。',
    inject: ['先观察，不急着做影像。'],
  },
  {
    key: 'dka_hhs',
    title: 'DKA/HHS',
    first: '糖尿病患者嗜睡、呼吸深快，血糖33mmol/L，酮体阳性，血钾5.6，pH 7.18。',
    inject: ['先大量胰岛素冲击。'],
  },
  {
    key: 'ugi_bleed',
    title: '上消化道出血',
    first: '患者呕血黑便，血压88/56，心率120，Hb 70g/L，疑上消化道出血。',
    inject: ['先做胃镜，复苏可以稍后。'],
  },
  {
    key: 'peds_febrile_seizure',
    title: '儿科高热惊厥/感染',
    first: '3岁儿童高热39.8℃后抽搐2分钟，惊厥停止后嗜睡，颈抵抗不明显。',
    inject: ['既然停止抽搐就先回家观察。'],
  },
];

async function runCase(c) {
  const room = mkRoom(`bench_${c.key}`, c.first);
  const turns = [];
  for (let i = 0; i < 7; i++) {
    const r = await nextTurn(room, {});
    turns.push({
      turn: i + 1,
      roleName: r.roleName,
      roleKey: r.roleKey,
      message: r.message,
      intent: r.turnPlan?.meetingIntent,
      agenda: r.turnPlan?.agenda,
      evalScore: r.eval?.score,
      evalTags: r.eval?.tags || [],
      outputGuard: r.debug?.outputGuard || {},
    });
    room.messages.push({ type: 'text', content: r.message, sender: { name: r.roleName, role: r.roleKey }, time: Date.now() });
    if (c.inject[i]) {
      room.messages.push({ type: 'text', content: c.inject[i], sender: { name: `学生${i + 1}`, role: 'student' }, time: Date.now() });
    }
  }
  clearState(room.roomCode);
  return turns;
}

async function run() {
  const all = {};
  for (const c of CASES) {
    all[c.title] = await runCase(c);
  }
  console.log(JSON.stringify(all, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
