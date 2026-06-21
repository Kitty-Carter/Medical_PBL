const sessions = new Map();

function getSession(roomCode) {
  return sessions.get(String(roomCode || 'unknown')) || null;
}

function setSession(roomCode, session) {
  sessions.set(String(roomCode || 'unknown'), session);
}

function removeSession(roomCode) {
  const key = String(roomCode || 'unknown');
  const s = sessions.get(key);
  sessions.delete(key);
  return s || null;
}

function listSessions() {
  return Array.from(sessions.entries()).map(([roomCode, s]) => ({
    roomCode,
    sessionId: s.sessionId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    adapterName: s.adapterName || 'deepseek_web',
  }));
}

module.exports = {
  getSession,
  setSession,
  removeSession,
  listSessions,
};
