/**
 * Playwright 客户端封装 - 浏览器启动与页面管理
 */

const { chromium } = require('playwright');

let browser = null;
let launchPromise = null;

async function getBrowser(options = {}) {
  if (browser) return browser;
  if (launchPromise) return launchPromise;
  launchPromise = chromium.launch({
    headless: !!(options.headless !== false),
    args: options.args || ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: options.launchTimeout || 30000,
  });
  browser = await launchPromise;
  browser.on('disconnected', () => {
    browser = null;
    launchPromise = null;
  });
  return browser;
}

async function newPage(options = {}) {
  const b = await getBrowser(options);
  const context = await b.newContext({
    viewport: options.viewport || { width: 1280, height: 800 },
    userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    timeout: options.contextTimeout || 60000,
  });
  const page = await context.newPage();
  page._relayContext = context;
  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    launchPromise = null;
  }
}

module.exports = {
  getBrowser,
  newPage,
  closeBrowser,
};
