const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const { relayConfig } = require('../config/config');
const { getSession, setSession, removeSession } = require('./sessionStore');

let browser = null;
let persistentContext = null;
let launching = null;

async function ensureBrowser() {
  if (browser) return browser;
  if (launching) return launching;
  launching = chromium.launch({
    headless: !!relayConfig.headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  browser = await launching;
  launching = null;
  browser.on('disconnected', () => {
    browser = null;
    persistentContext = null;
  });
  return browser;
}

async function ensurePersistentContext() {
  if (persistentContext) return persistentContext;
  if (!relayConfig.userDataDir) return null;
  persistentContext = await chromium.launchPersistentContext(relayConfig.userDataDir, {
    headless: !!relayConfig.headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return persistentContext;
}

async function createPage() {
  const ctx = await ensurePersistentContext();
  if (ctx) {
    const page = ctx.pages()[0] || await ctx.newPage();
    return { page, context: ctx, persistent: true };
  }
  const b = await ensureBrowser();
  const context = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  return { page, context, persistent: false };
}

async function getOrCreateRoomSession(roomCode) {
  const key = String(roomCode || 'unknown');
  const existing = getSession(key);
  if (existing?.page && !existing.page.isClosed()) {
    existing.updatedAt = Date.now();
    setSession(key, existing);
    return { ...existing, reused: true };
  }

  const { page, context, persistent } = await createPage();
  const session = {
    sessionId: randomUUID(),
    roomCode: key,
    page,
    context,
    persistent,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    adapterName: 'deepseek_web',
  };
  setSession(key, session);
  return { ...session, reused: false };
}

async function resetRoomSession(roomCode) {
  const s = removeSession(roomCode);
  if (!s) return false;
  try {
    if (!s.persistent && s.context) await s.context.close();
    else if (s.page && !s.page.isClosed()) await s.page.goto('about:blank').catch(() => null);
  } catch (_) {}
  return true;
}

async function shutdownBrowserPool() {
  const all = require('./sessionStore').listSessions();
  for (const item of all) {
    await resetRoomSession(item.roomCode);
  }
  if (persistentContext) {
    await persistentContext.close().catch(() => null);
    persistentContext = null;
  }
  if (browser) {
    await browser.close().catch(() => null);
    browser = null;
  }
}

module.exports = {
  ensureBrowser,
  getOrCreateRoomSession,
  resetRoomSession,
  shutdownBrowserPool,
};
