require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
app.use(cookieParser());
const server = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { maxHttpBufferSize: 2 * 1024 * 1024 });
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const knowledgeBase = require('./modules/knowledgeBase');
const generateDocx = require('./modules/docxExporter');
const { analyzeRoom } = require('./modules/analyzer');
const saveRoomRecords = require('./modules/storage');
const { listRecords, findRecord, createArchiveZip, safePathSegment } = require('./modules/storage');
const { sanitizeFileName, ensureInside } = require('./modules/safePath');
const { createSessionToken, verifySessionToken, requireSession, requireTeacher, validateLogin, getBearerToken } = require('./modules/auth');
const multer = require('multer');
const { pblConfig } = require('./modules/pbl/config');
const { buildEvidenceIndex } = require('./modules/pbl/evidence/indexBuilder');
const { nextTurn, ensureState, getState, clearState } = require('./modules/pbl/orchestrator');
const { retrieveEvidence } = require('./modules/pbl/evidence/retriever');
const { writeLessonMemory } = require('./modules/pbl/lessonMemoryWriter');
const { assembleDebugMeta } = require('./modules/pbl/debugMeta');
const { LongcatClient } = require('./modules/pbl/longcatClient');
const webRelayManager = require('./modules/pbl/webRelay/webRelayManager');
const { AstrBotClient } = require('./modules/pbl2/astrbot/client');
const { routeAiReply } = require('./modules/aiReplyRouter');
const { buildRolePrompt } = require('./modules/aiRoleCards');

// PBL2 新系统
const { nextTurnV2 } = require('./modules/pbl2/index');
const { assembleDebugMeta: assembleDebugMetaV2 } = require('./modules/pbl2/runtime/debugMeta');
const { ensureState: ensureStateV2, clearState: clearStateV2 } = require('./modules/pbl2/runtime/roomStore');
const pbl2Config = require('./modules/pbl2/config/config');

const RECORDS_ROOT = process.env.RECORDS_ROOT || path.join(__dirname, 'Medical_PBL', 'records');
const RECORDS_DOWNLOAD_ROUTE = process.env.RECORDS_DOWNLOAD_ROUTE || '/api/records';

function createDownloadToken() {
  return crypto.randomBytes(24).toString('hex');
}

function safeRecordId(input) {
  return String(input || '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '');
}

async function readRecordManifest(recordId) {
  const safeId = safeRecordId(recordId);
  const manifestPath = path.join(RECORDS_ROOT, safeId, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  return {
    manifest: JSON.parse(raw),
    recordDir: path.join(RECORDS_ROOT, safeId)
  };
}

function verifyRecordAccess(req, manifest) {
  const token = String(req.query.token || '');
  return token && manifest.downloadToken && token === manifest.downloadToken;
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

console.log(`[Server] 配置信息:`);
console.log(`[Server] HOST: ${HOST} (允许外部访问)`);
console.log(`[Server] PORT: ${PORT}`);
console.log(`[Server] RECORDS_ROOT: ${RECORDS_ROOT}`);
console.log(`[Server] 请确保防火墙已开放端口 ${PORT} 和 6185`);
console.log(`[Server] 局域网访问地址: http://[本机IP]:${PORT}`);
console.log(`[Server] 本地访问地址: http://localhost:${PORT}`);

const LONGCAI_API_KEY = pblConfig.longcatApiKey;
const LONGCAI_CHAT_URL = `${pblConfig.longcatBaseUrl}${pblConfig.longcatChatPath}`;
const MODEL_LITE = pblConfig.modelRole;
const MODEL_THINKING = pblConfig.modelThinking;
const ASTRBOT_WEBHOOKS = pbl2Config.astrbot?.webhookUrls || {};
const PBL_PIPELINE_VERSION = 'pbl-pipeline-v2.1';
const USE_PBL2 = String(process.env.USE_PBL2 || 'true').toLowerCase() !== 'false'; // 环境变量驱动，默认 true
const llmClient = new LongcatClient(pblConfig);
const astrBotClient = new AstrBotClient();
const roomsByCode = new Map();
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROOM_HISTORY_REPLAY = Number(process.env.MAX_ROOM_HISTORY_REPLAY || 500);
const PBL_UPLOADS_DIR = path.resolve(process.env.PBL_UPLOADS_DIR || path.join(process.cwd(), 'uploads'));
const DEBUG = String(process.env.PBL_DEBUG || '').toLowerCase() === 'true';


function generateRoomCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!roomsByCode.has(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function sortByStudentId(arr) {
  return [...arr].sort((a, b) => {
    const an = Number(a.studentId);
    const bn = Number(b.studentId);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a.studentId).localeCompare(String(b.studentId));
  });
}

function toAiSocketRole(roleKey) {
  if (roleKey === 'teacher') return 'ai_teacher';
  if (roleKey === 'B') return 'ai_student_B';
  if (roleKey === 'C') return 'ai_student_C';
  return 'ai_teacher';
}

function buildAstrBotRoomMessages(room) {
  const recentMessages = (room.messages || [])
    .filter((message) => message.type === 'text')
    .slice(-12);

  return recentMessages.map((message) => ({
    role: message.sender?.role?.startsWith?.('ai_') ? 'assistant' : 'user',
    content: `${message.sender?.name || '匿名'}：${message.content || ''}`,
  }));
}

const IDLE_TRIGGER_MS = 30000; // 30 秒无人发言后触发机器人
const MESSAGE_RESPONSE_DELAY_MS = 1800; // 用户发言后延迟 1.8 秒再让机器人回复
const AI_ROLES = ['B', 'C', 'teacher']; // 机器人2号、3号、4号

function getRoleDisplay(roleKey) {
  const map = {
    B: { userId: 'ai_student_B', userName: 'B同学', userType: 'ai_student_B' },
    C: { userId: 'ai_student_C', userName: 'C同学', userType: 'ai_student_C' },
    teacher: { userId: 'ai_teacher', userName: 'A教授', userType: 'ai_teacher' },
  };
  return map[roleKey] || map.B;
}

function pickRandomRole() {
  return AI_ROLES[Math.floor(Math.random() * AI_ROLES.length)];
}

function resetIdleTimer(roomCode, room) {
  if (room.closed || !room.aiEnabled) return;
  if (room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }
  room.lastMessageAt = Date.now();
  room.idleTimer = setTimeout(() => {
    room.idleTimer = null;
    runIdleCheck(roomCode, room);
  }, IDLE_TRIGGER_MS);
}

function scheduleMessageResponse(roomCode, room, fromStudent) {
  if (room.closed || !room.aiEnabled) return;
  if (fromStudent) {
    if (room.messageResponseTimer) {
      clearTimeout(room.messageResponseTimer);
      room.messageResponseTimer = null;
    }
  } else {
    if (room.messageResponseTimer) return;
  }
  room.messageResponseTimer = setTimeout(() => {
    room.messageResponseTimer = null;
    if (room.closed || room.pendingAiTurnId) return;

    let roleKey;
    let reason;

    if (fromStudent) {
      // 使用 aiReplyRouter 判断是否需要 AI 回复并决定角色
      const recentMessages = (room.messages || []).slice(-6);
      const lastStudentMsg = [...recentMessages].reverse().find(
        (m) => m.type === 'text' && m.sender?.role === 'student'
      );
      const studentText = lastStudentMsg ? (lastStudentMsg.content || '') : '';

      const routeResult = routeAiReply({
        text: studentText,
        recentMessages: recentMessages.map((m) => ({
          role: m.sender?.role || 'unknown',
          sender: m.sender?.name || '',
          content: m.content || '',
        })),
      });

      if (!routeResult.shouldReply) {
        if (pblConfig.debug) {
          console.log(`[AstrBot][Route] 跳过 AI 回复 room=${roomCode} reason=${routeResult.reason}`);
        }
        return;
      }

      roleKey = routeResult.role;
      reason = 'student_message_response';
    } else {
      roleKey = pickRandomRole();
      reason = 'teacher_message_response';
    }

    if (pblConfig.debug) {
      console.log(`[AstrBot][Message] ${fromStudent ? '学生' : '教师'}发言后触发 ${roleKey} room=${roomCode}`);
    }
    room.lastMessageAt = Date.now();
    room.aiGenerationEpoch = (room.aiGenerationEpoch || 0) + 1;
    emitAstrBotStream(roomCode, room, roleKey, reason, room.aiGenerationEpoch);
  }, MESSAGE_RESPONSE_DELAY_MS);
}

function clearAITimers(room) {
  if (room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }
  if (room.messageResponseTimer) {
    clearTimeout(room.messageResponseTimer);
    room.messageResponseTimer = null;
  }
  room.pendingAiTurnId = '';
  room.pendingAiChunks = [];
}

function runIdleCheck(roomCode, room) {
  if (room.closed || room.pendingAiTurnId || !room.aiEnabled) return;
  const elapsed = Date.now() - (room.lastMessageAt || 0);
  if (elapsed >= IDLE_TRIGGER_MS - 500) {
    const roleKey = pickRandomRole();
    if (pblConfig.debug) {
      console.log(`[AstrBot][Idle] 30s 无人发言，随机触发 ${roleKey} room=${roomCode}`);
    }
    room.lastMessageAt = Date.now();
    room.aiGenerationEpoch = (room.aiGenerationEpoch || 0) + 1;
    emitAstrBotStream(roomCode, room, roleKey, 'idle_20s', room.aiGenerationEpoch);
  }
}

function writeSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastRoomAIEvent(room, event, data) {
  for (const client of room.sseClients || []) {
    try {
      writeSSE(client.res, event, data);
    } catch (_) {}
  }
}

async function emitAstrBotStream(roomCode, room, roleKey, triggerReason = '', requestEpoch = room.aiGenerationEpoch || 0) {
  if (!room.aiEnabled) return;
  const turnId = uuidv4();
  room.pendingAiTurnId = turnId;
  room.pendingAiChunks = [];
  const abortController = new AbortController();
  room.astrBotAbortController = abortController;

  const roleDisplay = getRoleDisplay(roleKey);
  const basePayload = {
    streamId: turnId,
    roomCode,
    userId: roleDisplay.userId,
    userName: roleDisplay.userName,
    userType: roleDisplay.userType,
    timestamp: new Date().toISOString(),
  };

  try {
    if (!room.aiEnabled) return;
    const messages = buildAstrBotRoomMessages(room);
    let fullContent = '';

    broadcastRoomAIEvent(room, 'ai-start', {
      ...basePayload,
      triggerReason,
    });

    for await (const event of astrBotClient.streamChat({
      roleKey,
      roomCode,
      eventType: triggerReason || 'idle_20s',
      promptMode: 'normal',
      messages,
      signal: abortController.signal,
    })) {
      if (room.pendingAiTurnId !== turnId || (room.aiGenerationEpoch || 0) !== requestEpoch || !room.aiEnabled) {
        break;
      }
      if (event.type === 'delta' && event.delta) {
        fullContent = event.fullText || `${fullContent}${event.delta}`;
        broadcastRoomAIEvent(room, 'ai-chunk', {
          ...basePayload,
          delta: event.delta,
          content: fullContent,
        });
      }
    }

    if (room.pendingAiTurnId !== turnId || (room.aiGenerationEpoch || 0) !== requestEpoch || !room.aiEnabled) {
      return;
    }

    const finalContent = String(fullContent || '').trim();
    if (!finalContent) {
      broadcastRoomAIEvent(room, 'ai-error', {
        ...basePayload,
        message: 'AstrBot 未返回有效内容',
      });
      return;
    }

    const finalMessage = {
      id: uuidv4(),
      type: 'text',
      content: finalContent,
      sender: { id: roleDisplay.userId, name: roleDisplay.userName, role: roleDisplay.userType, studentId: roleDisplay.userName },
      time: Date.now(),
      timestamp: new Date().toISOString(),
    };
    room.messages.push(finalMessage);
    resetIdleTimer(roomCode, room);

    const toClientMsg = (m) => ({
      id: m.id || uuidv4(),
      userId: m.sender?.id,
      userName: m.sender?.name,
      userType: m.sender?.role,
      studentId: m.sender?.studentId,
      content: m.content,
      timestamp: m.timestamp || new Date(m.time).toISOString(),
    });
    if (typeof io !== 'undefined') {
      console.log(`[PBL2][MessageBroadcast] Broadcasting AI message to room ${roomCode}, id=${finalMessage.id}`);
      io.to(roomCode).emit('message', toClientMsg(finalMessage));
    }

    broadcastRoomAIEvent(room, 'ai-done', {
      ...basePayload,
      id: finalMessage.id,
      content: finalContent,
      timestamp: finalMessage.timestamp,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || error?.message?.includes('abort')) {
      if (room.pendingAiTurnId === turnId) {
        broadcastRoomAIEvent(room, 'ai-cancel', { ...basePayload });
      }
      return;
    }
    console.error('[AstrBot][Stream]', error.message);
    if (room.pendingAiTurnId === turnId) {
      broadcastRoomAIEvent(room, 'ai-error', {
        ...basePayload,
        message: error.message || 'AstrBot 调用失败',
      });
    }
  } finally {
    if (room.astrBotAbortController === abortController) {
      room.astrBotAbortController = null;
    }
    if (room.pendingAiTurnId === turnId) {
      room.pendingAiTurnId = '';
      room.pendingAiChunks = [];
    }
  }
}

async function emitAIMessage(io, roomCode, room, preferredRole, triggerReason = '', requestEpoch = room.aiGenerationEpoch || 0) {
  try {
    console.log(`[PBL][RouteHit] route=socket.message.auto_ai fn=emitAIMessage preferredRole=${preferredRole || 'auto'} room=${roomCode} pipeline=${PBL_PIPELINE_VERSION}`);
    
    // 如果启用 PBL2，使用新系统
    if (USE_PBL2) {
      return await emitAIMessageV2(io, roomCode, room, preferredRole, triggerReason, requestEpoch);
    }
    
    // 否则使用旧系统（保留）
    const pendingRelayRequestId = `wr_turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const relayAbortController = new AbortController();
    room.pendingWebRelayRequestId = pendingRelayRequestId;
    room.pendingRelayAbortController = relayAbortController;
    const result = await nextTurn(room, {
      preferredRole,
      triggerReason,
      webRelayRequestId: pendingRelayRequestId,
      abortSignal: relayAbortController.signal,
    });
    const role = result.roleKey;
    const displayName = result.roleName;
    const finalContent = result.message;
    const socketRole = toAiSocketRole(role);
    const turnId = uuidv4();
    room.pendingAiTurnId = turnId;
    room.pendingAiChunks = result.chunkPlan?.chunks || [];
    room.pendingChunksDiscarded = 0;
    room.chunkEmitDurationsMs = [];
    room.pblControl = room.pblControl || {};
    room.pblControl.agendaStage = result.turnPlan?.agenda || room.pblControl.agendaStage || '';
    const recentReplies = room.aiRecentReplies || [];
    recentReplies.push(finalContent);
    room.aiRecentReplies = recentReplies.slice(-12);
    const sendOne = async (chunk, isLast, remainAfter = []) => {
      if (room.pendingAiTurnId !== turnId) return false;
      const started = Date.now();
      const chunkMsg = {
        id: uuidv4(),
        userId: socketRole,
        userName: displayName,
        userType: socketRole,
        studentId: displayName,
        content: chunk.text,
        timestamp: new Date().toISOString(),
        type: 'text',
        debugMeta: (pblConfig.debug && isLast) ? assembleDebugMeta({
          ...result,
          interruptedByUser: room.pendingAiTurnId !== turnId,
          pendingChunksDiscarded: room.pendingChunksDiscarded || 0,
          chunkEmitDurationsMs: room.chunkEmitDurationsMs || [],
        }, { routeName: 'socket.message.auto_ai', triggerReason }) : undefined,
      };
      room.messages.push({
        type: 'text',
        content: chunk.text,
        sender: { id: socketRole, name: displayName, role: socketRole, studentId: displayName },
        time: Date.now(),
        debugMeta: chunkMsg.debugMeta,
      });
      io.to(roomCode).emit('message', chunkMsg);
      if (pblConfig.debug && chunkMsg.debugMeta) {
        console.log(`[PBL][SocketEmitDebugMeta] ${JSON.stringify(chunkMsg.debugMeta || {})}`);
      }
      room.chunkEmitDurationsMs.push(Date.now() - started);
      room.pendingAiChunks = remainAfter;
      if (!isLast) {
        const min = pblConfig.chunkMinIntervalMs || 320;
        const max = pblConfig.chunkMaxIntervalMs || 850;
        const wait = Math.floor(min + Math.random() * Math.max(1, max - min));
        await new Promise((r) => setTimeout(r, wait));
      }
      return true;
    };
    const chunks = result.chunkPlan?.chunks || [{ text: finalContent }];
    for (let i = 0; i < chunks.length; i++) {
      const remainAfter = chunks.slice(i + 1);
      const ok = await sendOne(chunks[i], i === chunks.length - 1, remainAfter);
      if (!ok) break;
    }
    if (room.pendingAiTurnId === turnId) {
      room.pendingAiTurnId = '';
      room.pendingAiChunks = [];
    }
    room.pendingWebRelayRequestId = '';
    room.pendingRelayAbortController = null;
  } catch (e) {
    room.pendingWebRelayRequestId = '';
    room.pendingRelayAbortController = null;
    console.warn('[PBL][emitAIMessage]', e.message);
  }
}

// PBL2 新系统的消息发送函数
async function emitAIMessageV2(io, roomCode, room, preferredRole, triggerReason = '', requestEpoch = room.aiGenerationEpoch || 0) {
  try {
    console.log(`[PBL2][RouteHit] route=socket.message.auto_ai room=${roomCode}`);
    
    // 调用 PBL2 新系统
    const result = await nextTurnV2(room, { preferredRole, triggerReason });
    if ((room.aiGenerationEpoch || 0) !== requestEpoch) {
      console.log(`[PBL2][DropStaleTurn] room=${roomCode} expectedEpoch=${requestEpoch} actualEpoch=${room.aiGenerationEpoch || 0}`);
      return;
    }
    
    const role = result.roleKey;
    const displayName = result.roleName;
    const chunks = result.chunks || [];
    const socketRole = toAiSocketRole(role);
    
    const turnId = uuidv4();
    room.pendingAiTurnId = turnId;
    room.pendingAiChunks = chunks;
    room.pendingChunksDiscarded = 0;
    room.chunkEmitDurationsMs = [];
    
    // 确保 state 已初始化
    const state = ensureStateV2(roomCode);
    
    const sendOne = async (chunk, isLast, remainAfter = []) => {
      if (room.pendingAiTurnId !== turnId || (room.aiGenerationEpoch || 0) !== requestEpoch) return false;
      
      const started = Date.now();
      const chunkMsg = {
        id: uuidv4(),
        userId: socketRole,
        userName: displayName,
        userType: socketRole,
        studentId: displayName,
        content: chunk.text,
        timestamp: new Date().toISOString(),
        type: 'text',
        debugMeta: (pbl2Config.debug && isLast) ? assembleDebugMetaV2(result, {
          routeName: 'socket.message.auto_ai',
          triggerReason,
          interruptedByUser: room.pendingAiTurnId !== turnId,
          state,
        }) : undefined,
      };
      
      room.messages.push({
        type: 'text',
        content: chunk.text,
        sender: { id: socketRole, name: displayName, role: socketRole, studentId: displayName },
        time: Date.now(),
        debugMeta: chunkMsg.debugMeta,
      });
      
      io.to(roomCode).emit('message', chunkMsg);
      
      if (pbl2Config.debug && chunkMsg.debugMeta) {
        console.log(`[PBL2][SocketEmitDebugMeta] ${JSON.stringify(chunkMsg.debugMeta)}`);
      }
      
      room.chunkEmitDurationsMs.push(Date.now() - started);
      room.pendingAiChunks = remainAfter;
      
      if (!isLast) {
        const min = pbl2Config.chunking.minIntervalMs;
        const max = pbl2Config.chunking.maxIntervalMs;
        const wait = Math.floor(min + Math.random() * (max - min));
        await new Promise(r => setTimeout(r, wait));
      }
      
      return true;
    };
    
    for (let i = 0; i < chunks.length; i++) {
      const remainAfter = chunks.slice(i + 1);
      const ok = await sendOne(chunks[i], i === chunks.length - 1, remainAfter);
      if (!ok) {
        room.pendingChunksDiscarded = remainAfter.length;
        break;
      }
    }
    
    if (room.pendingAiTurnId === turnId) {
      room.pendingAiTurnId = '';
      room.pendingAiChunks = [];
    }
  } catch (e) {
    console.error('[PBL2][emitAIMessageV2] 错误:', e.message);
    console.error(e.stack);
  }
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

fs.mkdir(PBL_UPLOADS_DIR, { recursive: true }).catch((e) => console.warn('[files][mkdir]', e.message));
const upload = multer({
  dest: PBL_UPLOADS_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
});

function authJsonHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

app.post('/api/session/login', (req, res) => {
  const check = validateLogin(req.body || {});
  if (!check.ok) return res.status(check.status).json({ ok: false, message: check.message });
  const user = {
    studentId: String(req.body.studentId).trim(),
    name: String(req.body.name).trim(),
    role: String(req.body.role).trim(),
  };
  const token = createSessionToken(user);
  
  // Set cookie for browser-based authentication
  res.cookie('session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    path: '/'
  });
  
  return res.json({ ok: true, token, user });
});

app.get('/api/system/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: PBL_PIPELINE_VERSION,
  });
});

app.post('/api/pbl/knowledge/reindex', async (req, res) => {
  try {
    const idx = await buildEvidenceIndex({ force: true });
    return res.json({ ok: true, chunks: idx.chunks.length, updatedAt: idx.updatedAt });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

app.post('/api/pbl/session/init', (req, res) => {
  const { roomCode } = req.body || {};
  const room = roomsByCode.get(String(roomCode || '').trim());
  if (!room) return res.status(404).json({ message: '房间不存在' });
  const state = ensureState(room);
  return res.json({ ok: true, sessionId: room.roomCode, state });
});

app.get('/api/pbl/session/:id/state', (req, res) => {
  const state = getState(req.params.id);
  if (!state) return res.status(404).json({ message: 'session not found' });
  return res.json({ ok: true, state });
});

app.post('/api/pbl/session/:id/next-turn', async (req, res) => {
  const room = roomsByCode.get(req.params.id);
  if (!room) return res.status(404).json({ message: '房间不存在' });
  try {
    // 链路统一：REST next-turn 与实时 Socket 自动回复保持同一 AI 主链路（PBL2）
    if (USE_PBL2) {
      const result = await nextTurnV2(room, {
        preferredRole: req.body?.preferredRole,
        triggerReason: req.body?.triggerReason || 'rest_manual_next_turn',
      });
      return res.json({
        sessionId: room.roomCode,
        roleName: result.roleName,
        message: result.message,
        debugMeta: pbl2Config.debug ? assembleDebugMetaV2(result, { routeName: 'rest.session.next_turn', triggerReason: req.body?.triggerReason || 'rest_manual_next_turn' }) : undefined,
        stateSnapshot: pbl2Config.debug ? ensureStateV2(room.roomCode) : undefined,
        pipelineVersion: result.pipelineVersion,
        provider: result.provider,
      });
    }

    // 兼容保留：当 USE_PBL2=false 时仍可走旧链路
    const result = await nextTurn(room, { preferredRole: req.body?.preferredRole, triggerReason: req.body?.triggerReason || 'rest_manual_next_turn' });
    return res.json({
      sessionId: result.sessionId,
      roleName: result.roleName,
      message: result.message,
      draft: pblConfig.debug ? result.draft : undefined,
      eval: pblConfig.debug ? result.eval : undefined,
      debug: pblConfig.debug ? result.debug : undefined,
      debugMeta: pblConfig.debug ? assembleDebugMeta(result, { routeName: 'rest.session.next_turn' }) : undefined,
      stateSnapshot: pblConfig.debug ? result.stateSnapshot : undefined,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});

app.get('/api/pbl/debug/ping-llm', async (req, res) => {
  if (!pblConfig.debug) return res.status(403).json({ success: false, error: 'debug_disabled' });
  try {
    const preferredModel = pblConfig.modelThinking || 'LongCat-Flash-Thinking-2601';
    const fallbackModel = pblConfig.modelLite || 'LongCat-Flash-Lite';
    const out = await llmClient.chat({
      model: preferredModel,
      preferred_model: preferredModel,
      fallback_model: fallbackModel,
      allow_fallback: true,
      messages: [
        { role: 'system', content: '你是医学PBL测试助手。请只回复“pong”。' },
        { role: 'user', content: 'ping' },
      ],
      max_tokens: 32,
      temperature: 0,
      tag: 'debug_ping_llm',
    });
    return res.json({
      success: true,
      provider: 'longcat',
      preferredModel,
      actualModel: out.actualModel || preferredModel,
      requestedModel: out.requestedModel || preferredModel,
      providerResolvedModel: out.providerResolvedModel || out.actualModel || preferredModel,
      modelFallback: !!out.modelFallback,
      modelFallbackReason: out.modelFallbackReason || '',
      responseId: out.responseId || '',
      usage: out.usage || {},
      contentPreview: String(out.content || '').slice(0, 80),
    });
  } catch (e) {
    const status = e?.response?.status || 500;
    const raw = e?.response?.data?.error || e?.response?.data || {};
    return res.status(status).json({
      success: false,
      preferredModel: pblConfig.modelThinking || '',
      actualModel: '',
      error: {
        status,
        message: raw?.message || e.message || 'llm_call_failed',
        type: raw?.type || e?.type || '',
        code: raw?.code || '',
      },
    });
  }
});

app.post('/api/pbl/web-relay/health', async (req, res) => {
  try {
    const h = await webRelayManager.health();
    return res.json({ ok: true, ...h });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/pbl/web-relay/open-session', (req, res) => {
  const { roomCode, site = 'deepseek_web' } = req.body || {};
  if (!roomCode) return res.status(400).json({ ok: false, message: 'roomCode required' });
  webRelayManager.openSession(roomCode, site).then((r) => res.json(r)).catch((e) => res.status(500).json({ ok: false, error: e.message }));
});

app.post('/api/pbl/web-relay/test-send', async (req, res) => {
  const { roomCode, role = 'A教授', text } = req.body || {};
  try {
    const r = await webRelayManager.testSend(roomCode || 'default', role, text);
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, relaySucceeded: false });
  }
});

app.post('/api/pbl/web-relay/reset-session', (req, res) => {
  const { roomCode } = req.body || {};
  webRelayManager.resetSession(roomCode || 'default').then((r) => res.json(r)).catch((e) => res.status(500).json({ ok: false, error: e.message }));
});

app.post('/api/pbl/web-relay/cancel-request', (req, res) => {
  const { requestId, reason } = req.body || {};
  const out = webRelayManager.cancelRequest(requestId, reason || 'manual_cancel');
  res.json({ ok: true, ...out });
});

app.get('/api/pbl/web-relay/metrics', (req, res) => {
  const m = webRelayManager.metrics();
  res.json({ ok: true, metrics: m });
});

app.post('/api/pbl/session/:id/end', async (req, res) => {
  const room = roomsByCode.get(req.params.id);
  if (!room) return res.status(404).json({ message: '房间不存在' });
  try {
    const state = ensureState(room);
    const evidencePack = await retrieveEvidence(state, { topK: pblConfig.evidenceTopK });
    const saved = await writeLessonMemory({ state, room, evidencePack });
    clearState(req.params.id);
    return res.json({ ok: true, saved });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

app.post('/api/room/create', requireSession, (req, res) => {
  const { studentId, name, role } = req.user || {};
  if (role !== 'teacher') return res.status(403).json({ message: '仅教师可创建房间' });
  if (!studentId?.trim() || !name?.trim()) {
    return res.status(400).json({ message: '学号和姓名不能为空' });
  }
  const roomCode = generateRoomCode();
  const room = {
    roomCode,
    teacherId: studentId,
    teacherName: name,
    users: new Map([[studentId, { id: studentId, name, role: 'teacher', studentId }]]),
    sockets: new Map(),
    participantRecords: new Map(),
    messages: [],
    messageCounts: new Map(),
    teacherScores: new Map(),
    aiRecentReplies: [],
    totalStudentMsgCount: 0,
    teacherMsgCount: 0,
    closed: false,
    pendingAiChunks: [],
    pendingAiTurnId: '',
    pendingWebRelayRequestId: '',
    pendingRelayAbortController: null,
    pendingChunksDiscarded: 0,
    chunkEmitDurationsMs: [],
      aiGenerationEpoch: 0,
      sseClients: new Set(),
      aiEnabled: false,
  };
  ensureState(room);
  room.lastMessageAt = Date.now();
  roomsByCode.set(roomCode, room);
  res.json({ roomCode });
});

app.post('/api/room/join', requireSession, (req, res) => {
  const { studentId, name, role } = req.user || {};
  const { roomCode } = req.body || {};
  if (!studentId?.trim() || !name?.trim() || !roomCode?.trim()) {
    return res.status(400).json({ message: '学号、姓名和房间号不能为空' });
  }
  const room = roomsByCode.get(String(roomCode).trim());
  if (!room) return res.status(404).json({ message: '房间不存在' });
  if (room.closed) return res.status(403).json({ message: '房间已关闭' });
  if (role === 'teacher' && room.teacherId !== studentId) {
    return res.status(403).json({ message: '只有房主老师可以进入该房间' });
  }
  if (role === 'student') room.participantRecords.set(studentId, { name });
  res.json({ ok: true });
});

app.get('/api/room/check/:code', (req, res) => {
  const room = roomsByCode.get(req.params.code);
  res.json({ exists: !!room && !room.closed });
});

app.get('/api/room/:code/ai/stream', (req, res) => {
  const user = verifySessionToken(getBearerToken(req));
  if (!user) return res.status(401).end();
  const room = roomsByCode.get(req.params.code);
  const studentId = user.studentId;
  if (!room || room.closed) {
    return res.status(404).end();
  }
  if (!studentId || (!room.participantRecords.has(studentId) && room.teacherId !== studentId)) {
    return res.status(403).end();
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  room.sseClients = room.sseClients || new Set();
  const client = { id: uuidv4(), res };
  room.sseClients.add(client);
  writeSSE(res, 'ready', { ok: true, roomCode: room.roomCode });

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    room.sseClients?.delete(client);
  });
});

app.get('/api/records', requireSession, requireTeacher, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const records = await listRecords(limit);
    res.json({ ok: true, records });
  } catch (e) {
    console.error('[records][list]', e);
    res.status(500).json({ ok: false, message: '读取记录失败' });
  }
});

app.get('/api/records/:recordId/manifest', async (req, res) => {
  try {
    const found = await findRecord(String(req.params.recordId || ''));
    if (!found) return res.status(404).json({ ok: false, message: '记录不存在' });
    
    if (!verifyRecordAccess(req, found.manifest)) {
      return res.status(403).json({ ok: false, message: '访问被拒绝' });
    }
    
    const { downloadToken, ...manifestWithoutToken } = found.manifest;
    return res.json({ ok: true, manifest: manifestWithoutToken });
  } catch (e) {
    console.error('[records][manifest]', e);
    return res.status(500).json({ ok: false, message: '读取记录失败' });
  }
});

app.get('/api/records/:recordId/download', async (req, res) => {
  try {
    const found = await findRecord(String(req.params.recordId || ''));
    if (!found) return res.status(404).json({ ok: false, message: '记录不存在' });
    
    if (!verifyRecordAccess(req, found.manifest)) {
      return res.status(403).json({ ok: false, message: '访问被拒绝' });
    }
    
    try {
      await fs.access(found.archivePath || found.zipPath);
    } catch (_) {
      await createArchiveZip(found.recordsDir, found.archivePath || found.zipPath);
    }
    
    const m = found.manifest;
    const filename = `课堂记录_${safePathSegment(m.teacherName, 'teacher', 30)}_${safePathSegment(m.date, 'date', 16)}_${safePathSegment(m.roomCode, 'room', 16)}.zip`;
    const filePath = found.archivePath || found.zipPath;
    
    return res.download(filePath, filename);
  } catch (e) {
    console.error('[records][download]', e);
    return res.status(404).json({ ok: false, message: '记录包不存在' });
  }
});

app.post('/api/files/upload', requireSession, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: '请选择文件' });
    const safeOriginal = sanitizeFileName(req.file.originalname, 'upload', 100);
    const ext = path.extname(safeOriginal).slice(0, 16);
    const fileId = `${uuidv4()}${ext}`;
    const targetPath = ensureInside(PBL_UPLOADS_DIR, path.join(PBL_UPLOADS_DIR, fileId));
    await fs.rename(req.file.path, targetPath);
    return res.json({ ok: true, fileName: safeOriginal, fileType: req.file.mimetype || 'application/octet-stream', fileSize: req.file.size, fileUrl: `/api/files/${encodeURIComponent(fileId)}` });
  } catch (e) {
    console.error('[files][upload]', e);
    return res.status(500).json({ ok: false, message: '上传失败' });
  }
});

app.get('/api/files/:fileId', requireSession, async (req, res) => {
  try {
    const fileId = sanitizeFileName(req.params.fileId, '', 120);
    if (!fileId || fileId !== req.params.fileId) return res.status(400).end();
    const filePath = ensureInside(PBL_UPLOADS_DIR, path.join(PBL_UPLOADS_DIR, fileId));
    return res.sendFile(filePath);
  } catch (_) {
    return res.status(404).end();
  }
});

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
io.cors = {
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
};

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of roomsByCode.entries()) {
    if (room.closed || room.pendingAiTurnId || !room.aiEnabled) continue;
    const last = room.lastMessageAt || 0;
    if (last > 0 && now - last >= IDLE_TRIGGER_MS) {
      runIdleCheck(code, room);
    }
  }
}, 3000);

io.on('connection', (socket) => {
  const { token, roomCode } = socket.handshake.auth || {};
  const sessionUser = verifySessionToken(token);
  if (!sessionUser || !roomCode) {
    socket.disconnect(true);
    return;
  }
  const { studentId, name, role } = sessionUser;

  const room = roomsByCode.get(roomCode);
  if (!room || room.closed) {
    socket.emit('room-error', { message: '房间不存在或已关闭' });
    socket.disconnect(true);
    return;
  }

  if (role === 'teacher' && room.teacherId !== studentId) {
    socket.emit('room-error', { message: '只有房主老师可以进入该房间' });
    socket.disconnect(true);
    return;
  }

  socket.join(roomCode);
  room.sockets.set(socket.id, { studentId, name, role });
  room.users.set(studentId, { id: studentId, name, role, studentId });
  if (role === 'student') room.participantRecords.set(studentId, { name });

  function emitStudentList() {
    const students = Array.from(room.participantRecords.entries())
      .filter(([sid]) => sid !== room.teacherId)
      .map(([sid, { name }]) => {
        const teacherScoreData = room.teacherScores.get(sid);
        let attitudeScore = 100;
        let thinkingScore = 100;
        let attitudeEdited = false;
        let thinkingEdited = false;
        
        if (teacherScoreData) {
          if (typeof teacherScoreData === 'number') {
            // 旧数据：单个数字
            attitudeScore = teacherScoreData;
            attitudeEdited = true;
          } else if (typeof teacherScoreData === 'object') {
            // 新数据：包含attitude和thinking
            attitudeScore = teacherScoreData.attitude?.score || 100;
            thinkingScore = teacherScoreData.thinking?.score || 100;
            attitudeEdited = teacherScoreData.attitude?.edited || false;
            thinkingEdited = teacherScoreData.thinking?.edited || false;
          }
        }
        
        return {
          studentId: sid,
          name,
          // 兼容旧字段
          score: attitudeScore,
          // 新的四项评分
          attitudeScore,
          thinkingScore,
          attitudeEdited,
          thinkingEdited
        };
      });
    io.to(roomCode).emit('student-list', sortByStudentId(students));
  }
  emitStudentList();

  const toClientMsg = (m) => {
    if (m.type === 'file') {
      return {
        id: m.id || uuidv4(),
        userId: m.sender?.id || m.userId,
        userName: m.sender?.name || m.userName,
        userType: m.sender?.role || m.userType,
        studentId: m.sender?.studentId || m.studentId,
        type: 'file',
        fileName: m.fileName,
        fileType: m.fileType,
        fileSize: m.fileSize,
        fileUrl: m.fileUrl,
        timestamp: m.timestamp || new Date(m.time).toISOString(),
      };
    }
    return {
      id: m.id || uuidv4(),
      userId: m.sender?.id || m.userId,
      userName: m.sender?.name || m.userName,
      userType: m.sender?.role || m.userType,
      studentId: m.sender?.studentId || m.studentId,
      content: m.content,
      timestamp: m.timestamp || new Date(m.time).toISOString(),
      debugMeta: m.debugMeta || undefined,
    };
  };

  if (role === 'teacher' && room.messages.length > 0) {
    room.messages.slice(-MAX_ROOM_HISTORY_REPLAY).forEach((m) => socket.emit('message', toClientMsg(m)));
  }

  resetIdleTimer(roomCode, room);

  socket.on('message', (payload) => {
    if (payload?.type === 'file') {
      const { fileName, fileType, fileSize, fileUrl } = payload;
      if (!fileName || !fileUrl) return;
      const declaredSize = Number(fileSize) || 0;
      if (declaredSize > MAX_FILE_SIZE) return;

      const msg = {
        id: uuidv4(),
        type: 'file',
        fileName,
        fileType: fileType || 'application/octet-stream',
        fileSize: declaredSize,
        fileUrl,
        sender: { id: studentId, name, role, studentId },
        time: Date.now(),
        timestamp: new Date().toISOString(),
      };
      room.messages.push(msg);
      io.to(roomCode).emit('message', toClientMsg(msg));
      resetIdleTimer(roomCode, room);
      scheduleMessageResponse(roomCode, room, role === 'student');
      return;
    }

    const content = (payload?.content || '').trim();
    if (!content) return;

    const sender = { id: studentId, name, role, studentId };
    const msg = {
      id: uuidv4(),
      type: 'text',
      content,
      sender,
      time: Date.now(),
      timestamp: new Date().toISOString(),
    };
    room.aiGenerationEpoch = (room.aiGenerationEpoch || 0) + 1;
    if (room.pendingAiTurnId) {
      room.pendingChunksDiscarded = (room.pendingAiChunks || []).length;
      room.pendingAiTurnId = '';
      room.pendingAiChunks = [];
    }
    if (room.pendingWebRelayRequestId) {
      webRelayManager.cancelRequest(room.pendingWebRelayRequestId, 'user_interrupted');
      room.pendingWebRelayRequestId = '';
    }
    if (room.pendingRelayAbortController) {
      room.pendingRelayAbortController.abort('user_interrupted');
      room.pendingRelayAbortController = null;
    }
    room.messages.push(msg);
    if (room.pendingAiTurnId) {
      room.pendingChunksDiscarded = (room.pendingAiChunks || []).length;
      room.pendingAiTurnId = '';
      room.pendingAiChunks = [];
    }

    resetIdleTimer(roomCode, room);
    scheduleMessageResponse(roomCode, room, role === 'student');

    if (role === 'teacher') room.teacherMsgCount++;
    if (role === 'student') {
      const c = room.messageCounts.get(studentId) || 0;
      room.messageCounts.set(studentId, c + 1);
      room.totalStudentMsgCount++;
    }
    io.to(roomCode).emit('message', toClientMsg(msg));
  });

  socket.on('set-ai-enabled', (payload) => {
    if (role !== 'teacher' || room.teacherId !== studentId) return;
    const enabled = !!payload?.enabled;
    room.aiEnabled = enabled;
    room.aiGenerationEpoch = (room.aiGenerationEpoch || 0) + 1;
    if (enabled) {
      resetIdleTimer(roomCode, room);
      io.to(roomCode).emit('ai-enabled', { enabled: true });
    } else {
      if (room.astrBotAbortController) {
        room.astrBotAbortController.abort();
        room.astrBotAbortController = null;
      }
      clearAITimers(room);
      io.to(roomCode).emit('ai-enabled', { enabled: false });
    }
  });

  if (role === 'teacher') {
    socket.emit('ai-enabled', { enabled: !!room.aiEnabled });
  }

  socket.on('score', (payload) => {
    if (role !== 'teacher' || room.teacherId !== studentId) return;
    const { studentId: sid, score, type, attitudeScore, thinkingScore } = payload || {};
    
    if (sid == null) return;
    
    // 兼容旧格式：{ studentId, score }
    if (typeof score === 'number' && score >= 0 && score <= 100) {
      // 旧格式：映射为attitude评分，thinking保持默认100
      const existingData = room.teacherScores.get(String(sid));
      if (existingData && typeof existingData === 'object') {
        // 已有新结构，只更新attitude
        existingData.attitude.score = score;
        existingData.attitude.edited = true;
        existingData.attitude.updatedAt = new Date().toISOString();
      } else {
        // 创建新结构
        room.teacherScores.set(String(sid), {
          attitude: {
            score: score,
            edited: true,
            updatedAt: new Date().toISOString()
          },
          thinking: {
            score: 100,
            edited: false,
            updatedAt: null
          }
        });
      }
    }
    
    // 新格式：{ studentId, attitudeScore, thinkingScore }
    if (typeof attitudeScore === 'number' && attitudeScore >= 0 && attitudeScore <= 100) {
      const existingData = room.teacherScores.get(String(sid));
      if (existingData && typeof existingData === 'object') {
        existingData.attitude.score = attitudeScore;
        existingData.attitude.edited = true;
        existingData.attitude.updatedAt = new Date().toISOString();
      } else {
        room.teacherScores.set(String(sid), {
          attitude: {
            score: attitudeScore,
            edited: true,
            updatedAt: new Date().toISOString()
          },
          thinking: {
            score: 100,
            edited: false,
            updatedAt: null
          }
        });
      }
    }
    
    if (typeof thinkingScore === 'number' && thinkingScore >= 0 && thinkingScore <= 100) {
      const existingData = room.teacherScores.get(String(sid));
      if (existingData && typeof existingData === 'object') {
        existingData.thinking.score = thinkingScore;
        existingData.thinking.edited = true;
        existingData.thinking.updatedAt = new Date().toISOString();
      } else {
        room.teacherScores.set(String(sid), {
          attitude: {
            score: 100,
            edited: false,
            updatedAt: null
          },
          thinking: {
            score: thinkingScore,
            edited: true,
            updatedAt: new Date().toISOString()
          }
        });
      }
    }
  });

  socket.on('close-room', async () => {
    if (role !== 'teacher' || room.teacherId !== studentId) return;
    room.closed = true;
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    if (room.messageResponseTimer) {
      clearTimeout(room.messageResponseTimer);
      room.messageResponseTimer = null;
    }

    const analysis = analyzeRoom(room);
    const sortedRows = [...(analysis.scoreTable || [])].sort((a, b) => {
      const an = Number(a.studentId);
      const bn = Number(b.studentId);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return String(a.studentId).localeCompare(String(b.studentId));
    });

    const rows = [
      ['学号', '姓名', '发言次数', '机器态度评分', '机器思维评分', '机器思维评分说明', '教师态度评分', '教师态度评分是否调整', '教师思维评分', '教师思维评分是否调整', '最终成绩']
    ];
    for (const s of sortedRows) {
      rows.push([
        String(s.studentId),
        s.name || '',
        s.messageCount || 0,
        s.machineAttitudeScore || 0,
        s.machineThinkingScore || 0,
        s.machineThinkingComment || '',
        s.teacherAttitudeScore || 100,
        s.teacherAttitudeEdited ? '是' : '否',
        s.teacherThinkingScore || 100,
        s.teacherThinkingEdited ? '是' : '否',
        s.finalScore || 0
      ]);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const csvContent = '\ufeff' + rows.map((r) => r.join(',')).join('\n');
    const csvBuffer = Buffer.from(csvContent, 'utf8');
    const transcriptText = (room.messages || [])
      .filter((m) => m.type === 'text')
      .sort((a, b) => (a.time || 0) - (b.time || 0))
      .map((m) => {
        const senderName = m.sender?.role?.startsWith?.('ai_')
          ? (m.sender?.name || 'AI')
          : `${m.sender?.name || '未知'}(${m.sender?.id || '-'})`;
        const timeStr = new Date(m.time || Date.now()).toLocaleString('zh-CN');
        return `${timeStr} ${senderName}\n${m.content || ''}`;
      })
      .join('\n\n');

    let docxBuffer;
    try {
      docxBuffer = await generateDocx(room, room.teacherName, dateStr);
    } catch (e) {
      console.error('[docx]', e);
      docxBuffer = Buffer.from('');
    }

    // 保存服务器记录
    let savedRecord = null;
    let saveError = null;
    
    try {
      const downloadToken = createDownloadToken();
      savedRecord = await saveRoomRecords(
        room.teacherName,
        dateStr,
        csvBuffer,
        docxBuffer,
        analysis,
        transcriptText,
        {
          roomCode,
          downloadToken,
          createdAt: new Date().toISOString()
        }
      );
    } catch (e) {
      saveError = e;
      console.error('[storage][saveRoomRecords]', e);
    }

    socket.emit('room_closed_files', {
      csv: csvBuffer.toString('base64'),
      docx: docxBuffer.toString('base64'),
      csvFilename: `成绩表_${dateStr}.csv`,
      docxFilename: `${room.teacherName}_${dateStr}.docx`,
      analysis,
      recordSaved: !!savedRecord,
      recordId: savedRecord?.recordId || '',
      recordsPath: savedRecord?.recordsDir || '',
      recordsDir: savedRecord?.recordsDir || '',
      archiveFilename: savedRecord?.archiveFilename || '',
      downloadUrl: savedRecord
        ? `${RECORDS_DOWNLOAD_ROUTE}/${encodeURIComponent(savedRecord.recordId)}/download?token=${encodeURIComponent(savedRecord.downloadToken)}` 
        : '',
      manifestUrl: savedRecord
        ? `${RECORDS_DOWNLOAD_ROUTE}/${encodeURIComponent(savedRecord.recordId)}/manifest?token=${encodeURIComponent(savedRecord.downloadToken)}` 
        : '',
      saveError: saveError ? '服务器记录保存失败，但浏览器即时下载文件仍可用' : ''
    });

    setTimeout(() => {
      io.to(roomCode).emit('room_closed');
      roomsByCode.delete(roomCode);
    }, 300);

    // 关闭房间的第一优先级是把文件和分析结果返回给前端，后续落盘/记忆写入放后台执行。
    setImmediate(async () => {
      try {
        const state = ensureState(room);
        const evidencePack = await retrieveEvidence(state, { topK: pblConfig.evidenceTopK });
        await writeLessonMemory({ state, room, evidencePack });
      } catch (e) {
        console.error('[storage][lessonMemory]', e);
      } finally {
        clearState(roomCode);
        knowledgeBase.loadKnowledgeBase().catch((e) => console.warn('[知识库重载]', e.message));
      }
    });
  });

  socket.on('disconnect', () => {
    room.sockets.delete(socket.id);
    room.users.delete(studentId);
    emitStudentList();
  });
});

// LATEST_RECORD_PACKAGE_DOWNLOAD_PATCH_V1
// 兜底接口：下载服务器上最近生成的课堂记录 zip 包。
// 用途：当前端历史记录 downloadUrl 失效时，仍可下载刚刚关闭的课堂记录包。
app.get('/api/records/latest/download', async (req, res) => {
  try {
    const fsModule = require('fs');
    const pathModule = require('path');

    const session = req.session || {};
    const hasPassword = !!process.env.SITE_ACCESS_PASSWORD;
    const isAuthed =
      !hasPassword ||
      !!session.authenticated ||
      !!session.isAuthenticated ||
      !!session.loggedIn ||
      !!session.user ||
      !!session.teacherId ||
      !!session.role;

    if (!isAuthed) {
      return res.status(401).send('请先登录后再下载课堂记录包');
    }

    const appRoot = __dirname;
    const candidateRoots = [
      process.env.RECORDS_ROOT,
      process.env.PBL_RECORDS_DIR,
      pathModule.join(appRoot, 'records'),
      pathModule.join(appRoot, 'Medical_PBL', 'records'),
      '/opt/medical-pbl-data/records'
    ].filter(Boolean);

    const roots = [];
    for (const root of candidateRoots) {
      try {
        const real = fsModule.realpathSync(root);
        if (fsModule.existsSync(real) && fsModule.statSync(real).isDirectory() && !roots.includes(real)) {
          roots.push(real);
        }
      } catch (_) {}
    }

    const zipFiles = [];

    function walk(dir, depth) {
      if (depth > 4) return;

      let entries = [];
      try {
        entries = fsModule.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        const full = pathModule.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;

        const lower = entry.name.toLowerCase();
        if (lower === 'archive.zip' || /^archive_.*\.zip$/.test(lower) || /record.*\.zip$/.test(lower)) {
          try {
            const stat = fsModule.statSync(full);
            zipFiles.push({
              path: full,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
            });
          } catch (_) {}
        }
      }
    }

    for (const root of roots) {
      walk(root, 0);
    }

    zipFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (!zipFiles.length) {
      return res.status(404).json({
        ok: false,
        message: '没有找到课堂记录 zip 包',
        searchedRoots: roots,
      });
    }

    const latest = zipFiles[0];
    const filename = `latest-medical-pbl-record-${new Date(latest.mtimeMs).toISOString().replace(/[:.]/g, '-')}.zip`;

    res.setHeader('Cache-Control', 'no-store');
    return res.download(latest.path, filename);
  } catch (error) {
    console.error('[Records] latest download failed:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || '下载最新记录包失败',
    });
  }
});

// LATEST_RECORD_PACKAGE_DOWNLOAD_PATCH_V2
// 不使用 /api/records/latest/download，避免被 /api/records/:id/download 误判为 id=latest。
app.get('/api/latest-record-package/download', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const child_process = require('child_process');

    const appRoot = __dirname;

    const candidateRoots = [
      process.env.RECORDS_ROOT,
      process.env.PBL_RECORDS_DIR,
      path.join(appRoot, 'records'),
      path.join(appRoot, 'room_records'),
      path.join(appRoot, 'room-records'),
      path.join(appRoot, 'exports'),
      path.join(appRoot, 'data'),
      path.join(appRoot, 'public', 'records'),
      '/opt/medical-pbl/records',
      '/opt/medical-pbl-data/records',
      '/tmp'
    ].filter(Boolean);

    const roots = [];
    for (const root of candidateRoots) {
      try {
        const real = fs.realpathSync(root);
        if (fs.existsSync(real) && fs.statSync(real).isDirectory() && !roots.includes(real)) {
          roots.push(real);
        }
      } catch (_) {}
    }

    const zipFiles = [];

    function walkForZip(dir, depth) {
      if (depth > 6) return;

      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
          walkForZip(full, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;

        const lower = entry.name.toLowerCase();
        if (
          lower.endsWith('.zip') &&
          (
            lower.includes('record') ||
            lower.includes('archive') ||
            lower.includes('pbl') ||
            lower.includes('room')
          )
        ) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > 0) {
              zipFiles.push({
                path: full,
                mtimeMs: stat.mtimeMs,
                size: stat.size,
              });
            }
          } catch (_) {}
        }
      }
    }

    for (const root of roots) {
      walkForZip(root, 0);
    }

    zipFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (zipFiles.length > 0) {
      const latest = zipFiles[0];
      const filename = `medical-pbl-latest-record-${new Date(latest.mtimeMs).toISOString().replace(/[:.]/g, '-')}.zip`;
      res.setHeader('Cache-Control', 'no-store');
      return res.download(latest.path, filename);
    }

    // 如果没有现成 zip，则尝试把最近的记录目录临时打包。
    const recordDirs = [];

    function walkForRecordDir(dir, depth) {
      if (depth > 5) return;

      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      const fileNames = entries.filter(e => e.isFile()).map(e => e.name.toLowerCase());
      const looksLikeRecordDir = fileNames.some(name =>
        name.endsWith('.json') ||
        name.endsWith('.html') ||
        name.endsWith('.csv') ||
        name.endsWith('.xlsx') ||
        name.endsWith('.txt') ||
        name.endsWith('.md')
      );

      if (looksLikeRecordDir) {
        try {
          const stat = fs.statSync(dir);
          recordDirs.push({
            path: dir,
            mtimeMs: stat.mtimeMs,
          });
        } catch (_) {}
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
        walkForRecordDir(path.join(dir, entry.name), depth + 1);
      }
    }

    for (const root of roots) {
      walkForRecordDir(root, 0);
    }

    recordDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (!recordDirs.length) {
      return res.status(404).json({
        ok: false,
        message: '没有找到可下载的课堂记录 zip，也没有找到可临时打包的记录目录',
        searchedRoots: roots,
      });
    }

    const latestDir = recordDirs[0].path;
    const tmpZip = `/tmp/medical-pbl-latest-record-${Date.now()}.zip`;

    try {
      child_process.execFileSync('zip', ['-qr', tmpZip, '.'], {
        cwd: latestDir,
        timeout: 30000,
      });
    } catch (zipError) {
      return res.status(500).json({
        ok: false,
        message: '找到了记录目录，但服务器缺少 zip 命令或打包失败',
        latestDir,
        error: zipError.message,
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.download(tmpZip, `medical-pbl-latest-record-${Date.now()}.zip`);
  } catch (error) {
    console.error('[Records] latest package download failed:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || '下载最新记录包失败',
    });
  }
});

// ===== AI 优化建议 API =====

// POST /api/ai/generate-optimization-review
// 关闭房间后，教师可选择角色和触发规则，生成 AI 优化建议
app.post('/api/ai/generate-optimization-review', requireSession, requireTeacher, async (req, res) => {
  try {
    const { recordId, roles = [], triggerRules: rawTriggerRules } = req.body || {};
    const triggerRules = Array.isArray(rawTriggerRules) ? rawTriggerRules : [];
    console.log('[AI_OPT_GENERATE_BODY]', JSON.stringify({ recordId, roles, triggerRules }));
    if (!recordId) {
      return res.status(400).json({ ok: false, message: '缺少 recordId' });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ ok: false, message: '请至少选择一个角色' });
    }

    console.log('[AI_OPT_GENERATE_RECORD_ID] recordId:', recordId);
    // 查找记录目录
    const record = await findRecord(recordId);
    console.log('[AI_OPT_GENERATE_FIND_RECORD]', JSON.stringify({ found: !!record, recordsDir: record?.recordsDir || null }));
    if (!record || !record.recordsDir) {
      return res.status(404).json({ ok: false, message: '记录不存在' });
    }

    const recordsDir = record.recordsDir;
    const transcriptPath = path.join(recordsDir, 'transcript.txt');

    // 读取对话记录
    let transcript = '';
    try {
      transcript = await fs.readFile(transcriptPath, 'utf8');
    } catch (e) {
      return res.status(404).json({ ok: false, message: '对话记录文件不存在' });
    }

    if (!transcript.trim()) {
      return res.status(400).json({ ok: false, message: '对话记录为空，无法生成优化建议' });
    }

    // 角色映射
    const roleMap = {
      teacher: 'teacher',
      professor: 'teacher',
      zheng: 'teacher',
      B: 'B',
      C: 'C'
    };

    const roleNames = {
      teacher: 'A教授',
      B: 'B同学',
      C: 'C同学'
    };

    // 为每个角色生成分析
    const results = {};
    const allReviews = [];

    for (const role of roles) {
      const roleKey = roleMap[role] || role;
      const roleName = roleNames[roleKey] || role;

      // 构建分析 prompt
      const rolePrompt = buildRolePrompt(roleKey);
      const triggerRulesText = (Array.isArray(triggerRules) && triggerRules.length > 0)
        ? `\n\n需要重点分析的 AI 触发规则：\n${triggerRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '';

      const analysisPrompt = `你是一名 AI 角色卡优化专家。请分析以下医学 PBL 课堂对话记录，针对「${roleName}」这个 AI 角色的表现，生成优化建议。

## 当前角色设定
${rolePrompt}

## 课堂对话记录
${transcript.slice(0, 8000)}
${triggerRulesText}

## 分析要求
请从以下维度分析「${roleName}」的表现：
1. 角色一致性：AI 回复是否符合角色设定？是否有偏离角色身份的表达？
2. 触发准确性：AI 是否在合适的时机被触发？是否有误触发或漏触发？
3. 回复质量：AI 回复是否有助于推进 PBL 讨论？是否提供了有价值的引导或补充？
4. 改进建议：针对角色技能卡，有哪些具体的优化建议？

请以 JSON 格式输出分析结果，格式如下：
\`\`\`json
{
  "role": "${roleName}",
  "roleKey": "${roleKey}",
  "summary": "整体评价（100字以内）",
  "scores": {
    "roleConsistency": 0-10,
    "triggerAccuracy": 0-10,
    "replyQuality": 0-10,
    "overall": 0-10
  },
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "suggestions": [
    {
      "category": "角色设定|触发规则|回复策略|其他",
      "priority": "high|medium|low",
      "description": "具体建议描述",
      "patchAction": "add|modify|delete",
      "targetFile": "文件名（如 A教授_角色技能卡.md）",
      "originalText": "需要修改的原文（如为新增则留空）",
      "suggestedText": "建议修改为的文本"
    }
  ],
  "triggerRuleAnalysis": [
    {
      "rule": "触发规则描述",
      "status": "effective|needs_adjustment|should_remove",
      "suggestion": "调整建议"
    }
  ]
}
\`\`\`

请确保输出是有效的 JSON，不要添加额外的解释文字。`;

      // 调用 AstrBot 进行分析
      console.log('[AI_OPT_ROLE_ANALYSIS_INPUT]', JSON.stringify({ roleKey, recordId, promptLength: analysisPrompt.length }));
      let fullText = '';
      try {
        // ASCII-safe: strip non-ASCII chars from recordId to avoid ByteString error in HTTP headers
        const safeRecordId = String(recordId).replace(/[^\x00-\x7F]/g, '');
        for await (const chunk of astrBotClient.streamChat({
          roomCode: `review-${safeRecordId}`,
          roleKey: `reviewer-${roleKey}`,
          messages: [{ role: 'system', content: analysisPrompt }],
          event: 'ai_optimization_review'
        })) {
          if (chunk.type === 'delta' && chunk.delta) {
            fullText += chunk.delta;
          }
        }
      } catch (streamErr) {
        console.error('[AI_OPT_ROLE_ANALYSIS_FAILED]', JSON.stringify({ roleKey, recordId, error: streamErr.message, stack: streamErr.stack?.slice(0, 500) }));
        console.error(`[AI Review] streamChat failed for role ${roleKey}:`, streamErr.message);
        results[roleKey] = { error: streamErr.message };
        continue;
      }

      // 解析 AI 返回的 JSON
      let analysisJson = null;
      try {
        // 尝试提取 JSON 块
        const jsonMatch = fullText.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : fullText;
        analysisJson = JSON.parse(jsonStr.trim());
      } catch (parseErr) {
        console.error(`[AI Review] JSON parse failed for role ${roleKey}:`, parseErr.message);
        results[roleKey] = { error: 'AI 返回格式异常，请重试', rawText: fullText.slice(0, 500) };
        continue;
      }

      results[roleKey] = analysisJson;
      allReviews.push(analysisJson);
    }

    if (allReviews.length === 0) {
      return res.status(500).json({
        ok: false,
        message: '所有角色分析均失败',
        details: results
      });
    }

    // 生成 reviewId
    const reviewId = `review_${recordId}_${Date.now()}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // 生成 ai_role_review.md
    let reviewMd = `# AI 角色卡优化建议报告\n\n`;
    reviewMd += `- **记录 ID**: ${recordId}\n`;
    reviewMd += `- **生成时间**: ${new Date().toISOString()}\n`;
    reviewMd += `- **分析角色**: ${roles.join(', ')}\n`;
    if (Array.isArray(triggerRules) && triggerRules.length > 0) {
      reviewMd += `- **触发规则**: ${triggerRules.join(', ')}\n`;
    }
    reviewMd += `\n---\n\n`;

    for (const review of allReviews) {
      reviewMd += `## ${review.role}（${review.roleKey}）\n\n`;
      reviewMd += `### 整体评价\n${review.summary}\n\n`;
      reviewMd += `### 评分\n`;
      reviewMd += `| 维度 | 得分 |\n|------|------|\n`;
      reviewMd += `| 角色一致性 | ${review.scores?.roleConsistency ?? '-'}/10 |\n`;
      reviewMd += `| 触发准确性 | ${review.scores?.triggerAccuracy ?? '-'}/10 |\n`;
      reviewMd += `| 回复质量 | ${review.scores?.replyQuality ?? '-'}/10 |\n`;
      reviewMd += `| 综合评分 | ${review.scores?.overall ?? '-'}/10 |\n\n`;

      if (review.strengths?.length > 0) {
        reviewMd += `### 优点\n${review.strengths.map((s) => `- ${s}`).join('\n')}\n\n`;
      }
      if (review.weaknesses?.length > 0) {
        reviewMd += `### 不足\n${review.weaknesses.map((w) => `- ${w}`).join('\n')}\n\n`;
      }
      if (review.suggestions?.length > 0) {
        reviewMd += `### 优化建议\n\n`;
        review.suggestions.forEach((s, i) => {
          reviewMd += `#### 建议 ${i + 1}: ${s.description}\n`;
          reviewMd += `- **类别**: ${s.category}\n`;
          reviewMd += `- **优先级**: ${s.priority}\n`;
          reviewMd += `- **操作**: ${s.patchAction}\n`;
          reviewMd += `- **目标文件**: ${s.targetFile}\n`;
          if (s.originalText) {
            reviewMd += `- **原文**: \`${s.originalText}\`\n`;
          }
          reviewMd += `- **建议修改为**: \`${s.suggestedText}\`\n\n`;
        });
      }
      reviewMd += `---\n\n`;
    }

    // 生成 ai_role_review.json
    const reviewJson = {
      reviewId,
      recordId,
      generatedAt: new Date().toISOString(),
      roles: roles,
      triggerRules: triggerRules,
      reviews: allReviews
    };

    // 生成 ai_role_patch.md（可执行的优化补丁）
    let patchMd = `# AI 角色卡优化补丁\n\n`;
    patchMd += `> 生成时间: ${new Date().toISOString()}\n`;
    patchMd += `> 记录 ID: ${recordId}\n`;
    patchMd += `> 补丁 ID: ${reviewId}\n\n`;
    patchMd += `## 应用说明\n\n`;
    patchMd += `本补丁包含以下优化建议，请人工审核后应用。\n`;
    patchMd += `应用前会自动备份当前角色卡到 \`ai_roles/_history/${timestamp}_${recordId}/\`。\n\n`;
    patchMd += `---\n\n`;

    for (const review of allReviews) {
      if (review.suggestions?.length > 0) {
        patchMd += `## ${review.role} 的优化补丁\n\n`;
        review.suggestions.forEach((s, i) => {
          patchMd += `### 补丁 ${i + 1}: ${s.description}\n\n`;
          patchMd += `- **目标文件**: \`ai_roles/${s.targetFile}\`\n`;
          patchMd += `- **操作**: \`${s.patchAction}\`\n`;
          patchMd += `- **优先级**: \`${s.priority}\`\n\n`;
          if (s.patchAction === 'add') {
            patchMd += `**新增内容**:\n\`\`\`markdown\n${s.suggestedText}\n\`\`\`\n\n`;
          } else if (s.patchAction === 'modify') {
            patchMd += `**查找**:\n\`\`\`\n${s.originalText}\n\`\`\`\n\n`;
            patchMd += `**替换为**:\n\`\`\`\n${s.suggestedText}\n\`\`\`\n\n`;
          } else if (s.patchAction === 'delete') {
            patchMd += `**删除内容**:\n\`\`\`\n${s.originalText}\n\`\`\`\n\n`;
          }
        });
        patchMd += `---\n\n`;
      }
    }

    // 保存到记录目录
    await fs.writeFile(path.join(recordsDir, 'ai_role_review.md'), reviewMd, 'utf8');
    await fs.writeFile(path.join(recordsDir, 'ai_role_review.json'), JSON.stringify(reviewJson, null, 2), 'utf8');
    await fs.writeFile(path.join(recordsDir, 'ai_role_patch.md'), patchMd, 'utf8');

    // 保存到 ai_optimization_reviews/pending
    const pendingDir = path.join(__dirname, 'ai_optimization_reviews', 'pending');
    await fs.mkdir(pendingDir, { recursive: true });
    const pendingReviewDir = path.join(pendingDir, reviewId);
    await fs.mkdir(pendingReviewDir, { recursive: true });
    await fs.writeFile(path.join(pendingReviewDir, 'ai_role_review.md'), reviewMd, 'utf8');
    await fs.writeFile(path.join(pendingReviewDir, 'ai_role_review.json'), JSON.stringify(reviewJson, null, 2), 'utf8');
    await fs.writeFile(path.join(pendingReviewDir, 'ai_role_patch.md'), patchMd, 'utf8');
    await fs.writeFile(path.join(pendingReviewDir, 'recordId.txt'), recordId, 'utf8');

    console.log(`[AI Review] Generated optimization review: ${reviewId} for record ${recordId}`);

    return res.json({
      ok: true,
      reviewId,
      recordId,
      files: {
        reviewMd: 'ai_role_review.md',
        reviewJson: 'ai_role_review.json',
        patchMd: 'ai_role_patch.md'
      },
      reviews: allReviews
    });
  } catch (error) {
    console.error('[AI Review] generate-optimization-review failed:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || '生成优化建议失败'
    });
  }
});

// POST /api/ai/apply-optimization
// 应用 AI 优化建议到角色卡文件
app.post('/api/ai/apply-optimization', requireSession, requireTeacher, async (req, res) => {
  try {
    const { recordId, reviewId } = req.body || {};
    console.log('[AI_OPT_APPLY_BODY]', JSON.stringify({ recordId, reviewId }));
    if (!recordId || !reviewId) {
      return res.status(400).json({ ok: false, message: '缺少 recordId 或 reviewId' });
    }

    // 查找 pending 目录中的 review
    const pendingDir = path.join(__dirname, 'ai_optimization_reviews', 'pending', reviewId);
    const patchPath = path.join(pendingDir, 'ai_role_patch.md');
    const reviewJsonPath = path.join(pendingDir, 'ai_role_review.json');

    let reviewJson;
    try {
      reviewJson = JSON.parse(await fs.readFile(reviewJsonPath, 'utf8'));
    } catch (e) {
      return res.status(404).json({ ok: false, message: '优化建议文件不存在' });
    }

    // 创建备份目录
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, 'ai_roles', '_history', `${timestamp}_${recordId}`);
    await fs.mkdir(backupDir, { recursive: true });

    // 备份当前角色卡文件
    const aiRolesDir = path.join(__dirname, 'ai_roles');
    const roleFiles = (await fs.readdir(aiRolesDir))
      .filter(f => f.endsWith('.md') && !f.startsWith('AI_助教团总规则') && !f.startsWith('AI_触发路由规则') && !f.startsWith('AI_兜底回复模板'));

    for (const file of roleFiles) {
      const srcPath = path.join(aiRolesDir, file);
      const destPath = path.join(backupDir, file);
      try {
        await fs.copyFile(srcPath, destPath);
        console.log(`[AI Apply] Backed up: ${file} -> ${backupDir}`);
      } catch (e) {
        console.error(`[AI Apply] Backup failed for ${file}:`, e.message);
      }
    }

    // 同时备份总规则文件
    const globalFiles = ['AI_助教团总规则.md', 'AI_触发路由规则.md', 'AI_兜底回复模板.md'];
    for (const file of globalFiles) {
      const srcPath = path.join(aiRolesDir, file);
      const destPath = path.join(backupDir, file);
      try {
        await fs.copyFile(srcPath, destPath);
      } catch (e) {
        // 文件可能不存在，忽略
      }
    }

    // 应用优化补丁
    const appliedPatches = [];
    const failedPatches = [];

    for (const review of (reviewJson.reviews || [])) {
      if (!review.suggestions) continue;

      for (const suggestion of review.suggestions) {
        // 过滤无效建议：必须同时具备 targetFile、suggestedText、patchAction
        if (!suggestion.targetFile || !suggestion.suggestedText || !suggestion.patchAction) {
          failedPatches.push({
            role: review.role,
            description: suggestion.description || '(无描述)',
            reason: '无效建议：缺少 targetFile、suggestedText 或 patchAction'
          });
          continue;
        }

        const targetFile = path.join(aiRolesDir, suggestion.targetFile);

        try {
          // 检查目标文件是否存在
          await fs.access(targetFile);
        } catch (e) {
          failedPatches.push({
            role: review.role,
            description: suggestion.description,
            reason: `目标文件不存在: ${suggestion.targetFile}`
          });
          continue;
        }

        try {
          if (suggestion.patchAction === 'add') {
            // 追加内容到文件末尾
            const currentContent = await fs.readFile(targetFile, 'utf8');
            const newContent = currentContent.trimEnd() + '\n\n' + suggestion.suggestedText + '\n';
            await fs.writeFile(targetFile, newContent, 'utf8');
            appliedPatches.push({
              role: review.role,
              description: suggestion.description,
              action: 'add',
              file: suggestion.targetFile
            });
          } else if (suggestion.patchAction === 'modify') {
            // 查找并替换
            const currentContent = await fs.readFile(targetFile, 'utf8');
            if (!currentContent.includes(suggestion.originalText)) {
              failedPatches.push({
                role: review.role,
                description: suggestion.description,
                reason: `未找到原文: ${suggestion.originalText.slice(0, 50)}...`
              });
              continue;
            }
            const newContent = currentContent.replace(suggestion.originalText, suggestion.suggestedText);
            await fs.writeFile(targetFile, newContent, 'utf8');
            appliedPatches.push({
              role: review.role,
              description: suggestion.description,
              action: 'modify',
              file: suggestion.targetFile
            });
          } else if (suggestion.patchAction === 'delete') {
            // 删除指定内容
            const currentContent = await fs.readFile(targetFile, 'utf8');
            if (!currentContent.includes(suggestion.originalText)) {
              failedPatches.push({
                role: review.role,
                description: suggestion.description,
                reason: `未找到要删除的内容: ${suggestion.originalText.slice(0, 50)}...`
              });
              continue;
            }
            const newContent = currentContent.replace(suggestion.originalText, '');
            await fs.writeFile(targetFile, newContent, 'utf8');
            appliedPatches.push({
              role: review.role,
              description: suggestion.description,
              action: 'delete',
              file: suggestion.targetFile
            });
          }
        } catch (patchErr) {
          console.error(`[AI Apply] Patch failed:`, patchErr.message);
          failedPatches.push({
            role: review.role,
            description: suggestion.description,
            reason: patchErr.message
          });
        }
      }
    }

    // 移动 review 到 applied 目录
    const appliedDir = path.join(__dirname, 'ai_optimization_reviews', 'applied');
    await fs.mkdir(appliedDir, { recursive: true });
    const appliedReviewDir = path.join(appliedDir, reviewId);

    // 如果目标已存在，先删除
    try {
      await fs.rm(appliedReviewDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }

    // 移动文件
    try {
      await fs.rename(pendingDir, appliedReviewDir);
    } catch (moveErr) {
      // 如果 rename 失败（跨文件系统），使用复制+删除
      console.warn('[AI Apply] rename failed, using copy+delete:', moveErr.message);
      await fs.cp(pendingDir, appliedReviewDir, { recursive: true });
      await fs.rm(pendingDir, { recursive: true, force: true });
    }

    // 更新 applied 目录中的状态文件
    const statusJson = {
      reviewId,
      recordId,
      appliedAt: new Date().toISOString(),
      backupDir,
      appliedPatches: appliedPatches.length,
      failedPatches: failedPatches.length,
      patches: { applied: appliedPatches, failed: failedPatches }
    };
    await fs.writeFile(
      path.join(appliedReviewDir, 'apply_status.json'),
      JSON.stringify(statusJson, null, 2),
      'utf8'
    );

    console.log(`[AI Apply] Optimization applied: ${reviewId}, ${appliedPatches.length} patches applied, ${failedPatches.length} failed`);

    return res.json({
      ok: true,
      reviewId,
      recordId,
      backupDir: `ai_roles/_history/${path.basename(backupDir)}`,
      appliedCount: appliedPatches.length,
      failedCount: failedPatches.length,
      appliedPatches,
      failedPatches
    });
  } catch (error) {
    console.error('[AI Apply] apply-optimization failed:', error);
    return res.status(500).json({
      ok: false,
      message: error.message || '应用优化建议失败'
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[PBL][Boot] pipeline=${PBL_PIPELINE_VERSION}`);
  console.log(`[PBL][Boot] PBL_DEBUG=${String(pblConfig.debug)}`);
  console.log(`[PBL][Boot] USE_PBL2=${USE_PBL2}`);
  if (USE_PBL2) {
    console.log(`[PBL2][Boot] provider=${pbl2Config.astrbot?.mode === 'openapi' ? 'astrbot_openapi' : 'astrbot_webhook'}`);
    console.log(`[PBL2][Boot] baseURLConfigured=${!!String(pbl2Config.astrbot?.baseURL || '').trim()}`);
    console.log(`[PBL2][Boot] apiKeyPresent=${!!String(pbl2Config.astrbot?.apiKey || '').trim()}`);
    console.log(`[PBL2][Boot] webhookConfigured.teacher=${!!String(ASTRBOT_WEBHOOKS.teacher || '').trim()}`);
    console.log(`[PBL2][Boot] webhookConfigured.B=${!!String(ASTRBOT_WEBHOOKS.B || '').trim()}`);
    console.log(`[PBL2][Boot] webhookConfigured.C=${!!String(ASTRBOT_WEBHOOKS.C || '').trim()}`);
    console.log(`[PBL2][Boot] timeoutMs=${pbl2Config.astrbot?.timeoutMs || 0}`);
  } else {
    console.log(`[PBL][Boot] LONGCAT_BASE_URL_CONFIGURED=${!!String(pblConfig.longcatBaseUrl || '').trim()}`);
    console.log(`[PBL][Boot] LONGCAT_CHAT_PATH_CONFIGURED=${!!String(pblConfig.longcatChatPath || '').trim()}`);
    console.log(`[PBL][Boot] LONGCAT_API_KEY_PRESENT=${!!String(pblConfig.longcatApiKey || '').trim()}`);
    console.log(`[PBL][Boot] LONGCAT_MODEL_THINKING=${pblConfig.modelThinking}`);
    console.log(`[PBL][Boot] LONGCAT_MODEL_LITE=${pblConfig.modelLite}`);
    console.log(`[PBL][Boot] PBL_MODEL_POLICY=${pblConfig.modelPolicy}`);
  }
  console.log('');
  console.log('========================================');
  console.log('医学讨论室已启动');
  console.log('========================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${getLocalIP() || '(请用 ipconfig 查看本机IPv4)'}:${PORT}`);
  console.log('========================================');
  console.log('');
  // 先保证站点可访问，再后台构建知识库，避免启动阶段阻塞。
  knowledgeBase.loadKnowledgeBase().catch((e) => {
    console.warn('[知识库初始化失败] 已降级为无RAG模式:', e.message);
  });
  buildEvidenceIndex({ force: false }).catch((e) => {
    console.warn('[PBL][证据索引初始化失败]', e.message);
  });
});

// 获取本机局域网 IPv4 地址
function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过内部地址和 IPv6
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }
  const preferred = candidates.find((ip) => isPreferredLanIPv4(ip));
  return preferred || candidates[0] || null;
}

function isPreferredLanIPv4(ip) {
  if (!ip) return false;
  if (/^198\.(18|19)\./.test(ip)) return false;
  return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}
