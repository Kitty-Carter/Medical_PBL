/**
 * DeepSeek 网页聊天适配器
 * 选择器需根据实际页面更新：https://chat.deepseek.com 等
 */

const { BaseWebChatAdapter } = require('./baseWebChatAdapter');

const DEEPSEEK_CHAT_URL = process.env.DEEPSEEK_WEB_URL || 'https://chat.deepseek.com';

const SELECTORS = {
  input: [
    '[placeholder*="给 DeepSeek 发送"]',
    'textarea[placeholder*="给 DeepSeek"]',
    'input[placeholder*="给 DeepSeek"]',
    'textarea[placeholder*="DeepSeek"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="输入"]',
    'textarea[placeholder*="输入消息"]',
    'textarea[data-id="composer"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
    '[role="textbox"]',
  ],
  sendButton: [
    'button[type="submit"]',
    'button[aria-label*="发送"]',
    '[aria-label*="发送"]',
    'button:has-text("发送")',
    'button:has-text("Send")',
    'svg[class*="send"]',
    '[data-testid="send-button"]',
  ],
  response: [
    '[data-testid="message-content"]',
    '[class*="message"][class*="content"]',
    '[class*="markdown"]',
    'article',
    '.prose',
    '[class*="assistant"]',
    '[class*="reply"]',
    '[class*="bubble"]',
  ],
  streamingIndicator: [
    '[class*="typing"]',
    '[class*="streaming"]',
    '[class*="loading"]',
    '.animate-pulse',
  ],
};

async function findSelector(page, selectors, options = {}) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel);
      const count = await loc.count();
      if (count > 0) {
        await loc.first().waitFor({ state: 'visible', timeout: options.timeout || 5000 }).catch(() => null);
        return sel;
      }
    } catch (_) {}
  }
  return null;
}

class DeepSeekWebAdapter extends BaseWebChatAdapter {
  constructor(options = {}) {
    super({ ...options, name: 'deepseek_web', baseUrl: DEEPSEEK_CHAT_URL });
  }

  async ensureReady(page) {
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(this.timeout, 45000) });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const inputSel = await findSelector(page, SELECTORS.input, { timeout: 10000 });
    if (!inputSel) {
      const placeholder = await page.getByPlaceholder(/DeepSeek|输入|发送/).first().count().catch(() => 0);
      if (placeholder > 0) return true;
      throw new Error('deepseek_adapter: input not found');
    }
    return true;
  }

  async sendPrompt(page, text) {
    const byPlaceholder = page.getByPlaceholder(/DeepSeek|输入|发送/).first();
    const placeholderCount = await byPlaceholder.count();
    if (placeholderCount > 0) {
      await byPlaceholder.click();
      await byPlaceholder.fill('');
      await byPlaceholder.fill(text);
    } else {
      const inputSel = await findSelector(page, SELECTORS.input);
      if (!inputSel) throw new Error('deepseek_adapter: input not found');
      const loc = page.locator(inputSel).first();
      await loc.click();
      await loc.fill('');
      await loc.fill(text);
    }
    await new Promise((r) => setTimeout(r, 300));
    const sendSel = await findSelector(page, SELECTORS.sendButton, { timeout: 3000 });
    if (sendSel) {
      await page.locator(sendSel).first().click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  async waitForCompletion(page, maxWait = 60000) {
    const start = Date.now();
    const checkInterval = 500;
    let lastLen = 0;
    let stableCount = 0;
    const stableThreshold = 3;
    while (Date.now() - start < maxWait) {
      const text = await this.getFinalResponse(page);
      const len = (text || '').length;
      if (len > 0 && len === lastLen) {
        stableCount += 1;
        if (stableCount >= stableThreshold) return true;
      } else {
        stableCount = 0;
      }
      lastLen = len;
      await new Promise((r) => setTimeout(r, checkInterval));
    }
    return false;
  }

  async getFinalResponse(page) {
    for (const sel of SELECTORS.response) {
      try {
        const loc = page.locator(sel).last();
        if (await loc.count() > 0) {
          const text = await loc.innerText();
          if (text && text.trim().length > 10) return text.trim();
        }
      } catch (_) {}
    }
    const body = await page.locator('body').innerText();
    const lines = body.split('\n').filter((l) => l.trim().length > 20);
    return lines.slice(-3).join('\n').trim() || '';
  }
}

module.exports = { DeepSeekWebAdapter };
