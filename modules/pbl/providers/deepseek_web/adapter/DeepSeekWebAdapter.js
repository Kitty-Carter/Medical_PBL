const { BaseWebChatAdapter } = require('./BaseWebChatAdapter');
const { relayConfig } = require('../config/config');

class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

const SELECTORS = {
  input: [
    'textarea[placeholder*="给 DeepSeek"]',
    'textarea[placeholder*="发送消息"]',
    'textarea[placeholder*="输入"]',
    'textarea[data-id="composer"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"]',
    'textarea',
  ],
  send: [
    'button[type="submit"]',
    'button[aria-label*="发送"]',
    'button:has-text("发送")',
    '[data-testid="send-button"]',
    'button:has(svg)',
  ],
  stop: [
    'button:has-text("停止")',
    'button[aria-label*="停止"]',
    'button:has-text("Stop")',
  ],
  assistantBubble: [
    '[data-testid="message-content"]',
    '[class*="assistant"] [class*="markdown"]',
    '[class*="assistant"] [class*="content"]',
    '[class*="message"] [class*="markdown"]',
    '.markdown-body',
    'article',
  ],
  generating: [
    '[class*="typing"]',
    '[class*="loading"]',
    '[class*="streaming"]',
  ],
};

async function pickSelector(page, list, timeout = 2500) {
  for (const sel of list) {
    try {
      const loc = page.locator(sel);
      const count = await loc.count();
      if (count > 0) {
        await loc.first().waitFor({ state: 'visible', timeout }).catch(() => null);
        return sel;
      }
    } catch (_) {}
  }
  return '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class DeepSeekWebAdapter extends BaseWebChatAdapter {
  constructor(options = {}) {
    super({ name: 'deepseek_web', baseUrl: relayConfig.baseUrl, timeoutMs: relayConfig.requestTimeoutMs, ...options });
    this.selectorFallbackUsed = false;
  }

  async ensureReady(page) {
    await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => null);
    await sleep(1200);

    const input = await pickSelector(page, SELECTORS.input, 3000);
    if (!input) {
      const fallbackByPlaceholder = await page.getByPlaceholder(/DeepSeek|发送消息|输入/).first().count().catch(() => 0);
      if (!fallbackByPlaceholder) {
        throw new ProviderError('SELECTOR_INPUT_NOT_FOUND', 'deepseek_adapter: input not found', { selectors: SELECTORS.input });
      }
      this.selectorFallbackUsed = true;
    }
    return true;
  }

  async sendPrompt(page, text) {
    const placeholderInput = page.getByPlaceholder(/DeepSeek|发送消息|输入/).first();
    const phCount = await placeholderInput.count().catch(() => 0);

    if (phCount > 0) {
      await placeholderInput.click();
      await placeholderInput.fill('');
      await placeholderInput.fill(text);
      this.selectorFallbackUsed = true;
    } else {
      const inputSel = await pickSelector(page, SELECTORS.input, 2500);
      if (!inputSel) throw new ProviderError('SELECTOR_INPUT_NOT_FOUND', 'deepseek_adapter: input not found');
      const input = page.locator(inputSel).first();
      await input.click();
      await input.fill('');
      await input.fill(text);
    }

    await sleep(200);
    const sendSel = await pickSelector(page, SELECTORS.send, 2000);
    if (sendSel) {
      await page.locator(sendSel).first().click();
      return true;
    }

    await page.keyboard.press('Enter');
    this.selectorFallbackUsed = true;
    return true;
  }

  async waitForStreamingStart(page) {
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const txt = await this.readStreamingText(page);
      if (txt && txt.length > 5) return true;
      const generatingSel = await pickSelector(page, SELECTORS.generating, 300);
      if (generatingSel) return true;
      await sleep(250);
    }
    return false;
  }

  async readStreamingText(page) {
    for (const sel of SELECTORS.assistantBubble) {
      try {
        const loc = page.locator(sel).last();
        const c = await loc.count();
        if (!c) continue;
        const text = (await loc.innerText().catch(() => '')).trim();
        if (text) return text;
      } catch (_) {}
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const lines = String(bodyText).split('\n').map((x) => x.trim()).filter((x) => x.length > 10);
    return lines.slice(-1)[0] || '';
  }

  async waitForCompletion(page) {
    const timeoutMs = this.timeoutMs;
    const started = Date.now();
    let last = '';
    let stableSince = 0;

    while (Date.now() - started < timeoutMs) {
      const cur = await this.readStreamingText(page);
      if (cur && cur === last) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= relayConfig.completionStableMs) return true;
      } else {
        stableSince = 0;
      }
      last = cur;
      await sleep(relayConfig.pollIntervalMs);
    }
    throw new ProviderError('WAIT_COMPLETION_TIMEOUT', 'deepseek_adapter: wait completion timeout');
  }

  async getFinalResponse(page) {
    const text = await this.readStreamingText(page);
    if (!text) throw new ProviderError('EMPTY_RESPONSE', 'deepseek_adapter: empty response');
    return text;
  }

  async abortGeneration(page) {
    const stopSel = await pickSelector(page, SELECTORS.stop, 600);
    if (stopSel) {
      await page.locator(stopSel).first().click().catch(() => null);
      return true;
    }
    await page.keyboard.press('Escape').catch(() => null);
    return false;
  }
}

module.exports = {
  DeepSeekWebAdapter,
  ProviderError,
  SELECTORS,
};
