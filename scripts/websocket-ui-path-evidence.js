const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${data.message || 'error'}`);
  return data;
}

async function connectSocket({ studentId, name, role, roomCode }) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      transports: ['websocket'],
      auth: { studentId, name, role, roomCode },
      timeout: 8000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(e));
  });
}

async function run() {
  const teacher = { studentId: 't9001', name: 'TeacherDemo', role: 'teacher' };
  const student = { studentId: 's9001', name: 'StudentDemo', role: 'student' };
  const created = await postJson('/api/room/create', teacher);
  const roomCode = created.roomCode;
  await postJson('/api/room/join', { ...student, roomCode });

  const tSocket = await connectSocket({ ...teacher, roomCode });
  const sSocket = await connectSocket({ ...student, roomCode });

  const aiMessages = [];
  const capture = (msg) => {
    if (msg?.userType && String(msg.userType).startsWith('ai_')) {
      aiMessages.push(msg);
    }
  };
  tSocket.on('message', capture);
  sSocket.on('message', capture);

  const dicCase = '产妇因产后出血约1800mL入院，血压82/45mmHg，HR128次/分，SpO2 91%。Hb 62g/L，PLT 58x10^9/L，PT 22s，APTT 65s，纤维蛋白原1.0g/L。请开始。';
  sSocket.emit('message', { content: dicCase });
  const studentFollowups = [
    '我担心持续渗血，补液后血压仍在86/50附近。',
    '复查乳酸4.9，尿量偏少。',
    '我在想是否是单纯失血，不一定DIC。',
    'PT和APTT继续延长，纤维蛋白原还在下降。',
    '现在出血点增多，皮肤瘀斑明显。',
    '如果先上升压药，会不会掩盖低灌注？',
    '我倾向先补液再看，不急着补凝血成分。',
    'Hb继续下降到58g/L，PLT到45。',
    '目前意识有点烦躁，末梢灌注差。',
    '是否应考虑升级ICU监护？',
    '输血后血压短暂回升，但很快又降到84/48。',
    '若30分钟后乳酸继续升高，路径要怎么改？',
    'D-二聚体明显升高，担心凝血紊乱加重。',
    '如果先控源再纠正凝血，会不会太慢？',
    '我想听听先后顺序：复苏、止血、纠凝。'
  ];
  for (let i = 0; i < studentFollowups.length; i++) {
    sSocket.emit('message', { content: `学生补充${i + 1}：${studentFollowups[i]}` });
    await wait(150);
  }
  for (let j = 0; j < 6; j++) {
    tSocket.emit('message', { content: `老师追问${j + 1}：请围绕凝血指标和灌注变化回答。` });
    await wait(120);
  }

  await wait(6000);
  tSocket.disconnect();
  sSocket.disconnect();

  const rows = aiMessages.slice(0, 6).map((m, idx) => ({
    turn: idx + 1,
    userType: m.userType,
    textPreview: String(m.content || '').slice(0, 180),
    debugMeta: m.debugMeta || null,
  }));
  console.log(JSON.stringify({ roomCode, aiCount: aiMessages.length, rows }, null, 2));
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
