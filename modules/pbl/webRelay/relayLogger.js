const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..', '..', 'records', 'web_relay');

function ensureDir() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function appendJsonl(filename, payload) {
  ensureDir();
  const line = `${JSON.stringify(payload)}\n`;
  fs.appendFileSync(path.join(BASE_DIR, filename), line, 'utf8');
}

function logEvent(payload) {
  const key = dayKey(payload?.ts || Date.now());
  appendJsonl(`relay-events-${key}.jsonl`, payload);
}

function logError(payload) {
  const key = dayKey(payload?.ts || Date.now());
  appendJsonl(`relay-errors-${key}.jsonl`, payload);
}

module.exports = {
  logEvent,
  logError,
};
