const { newPage } = require('./playwrightClient');
const sessionStore = require('./relaySessionStore');

const MAX_SESSIONS = Number(process.env.PBL_WEB_RELAY_MAX_SESSIONS || 4);

function safeClose(pageOrContext) {
  return pageOrContext?.close?.().catch(() => {});
}

async function evictOldestIfNeeded() {
  const sessions = sessionStore.list();
  if (sessions.length < MAX_SESSIONS) return;
  const oldest = [...sessions].sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0))[0];
  if (!oldest?.roomCode) return;
  sessionStore.remove(oldest.roomCode);
}

async function getOrCreate(roomCode, { forceNew = false } = {}) {
  if (!forceNew) {
    const existed = sessionStore.get(roomCode);
    if (existed?.page) {
      sessionStore.touch(roomCode);
      return { session: existed, reused: true };
    }
  }
  await evictOldestIfNeeded();
  const page = await newPage();
  const context = page._relayContext;
  const session = {
    roomCode,
    page,
    context,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessionStore.set(roomCode, session);
  return { session, reused: false };
}

async function reset(roomCode) {
  const existed = sessionStore.get(roomCode);
  if (existed?.page) await safeClose(existed.page);
  if (existed?.context) await safeClose(existed.context);
  sessionStore.remove(roomCode);
}

function stats() {
  const list = sessionStore.list();
  return {
    maxSessions: MAX_SESSIONS,
    sessionCount: list.length,
    sessions: list,
  };
}

module.exports = {
  getOrCreate,
  reset,
  stats,
};
