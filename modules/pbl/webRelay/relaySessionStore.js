/**
 * Web Relay 会话存储 - roomCode -> page/context
 */

const store = new Map();

function get(roomCode) {
  return store.get(String(roomCode || ''));
}

function set(roomCode, data) {
  store.set(String(roomCode || ''), { ...data, updatedAt: Date.now() });
}

function touch(roomCode) {
  const key = String(roomCode || '');
  const s = store.get(key);
  if (!s) return;
  s.updatedAt = Date.now();
  store.set(key, s);
}

function has(roomCode) {
  return store.has(String(roomCode || ''));
}

function remove(roomCode) {
  const s = store.get(String(roomCode || ''));
  if (s?.page) {
    s.page.close?.().catch(() => {});
  }
  if (s?.context) {
    s.context.close?.().catch(() => {});
  }
  store.delete(String(roomCode || ''));
}

function list() {
  return Array.from(store.entries()).map(([code, v]) => ({
    roomCode: code,
    hasPage: !!v.page,
    busy: !!v.busy,
    updatedAt: v.updatedAt,
  }));
}

module.exports = { get, set, touch, has, remove, list };
