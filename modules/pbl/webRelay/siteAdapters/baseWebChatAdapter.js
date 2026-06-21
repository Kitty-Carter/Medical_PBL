/**
 * Web 聊天适配器基类
 */

class BaseWebChatAdapter {
  constructor(options = {}) {
    this.name = options.name || 'base';
    this.baseUrl = options.baseUrl || '';
    this.timeout = options.timeout || 90000;
  }

  async ensureReady(page) {
    return true;
  }

  async sendPrompt(page, text) {
    throw new Error('sendPrompt not implemented');
  }

  async waitForCompletion(page) {
    throw new Error('waitForCompletion not implemented');
  }

  async getFinalResponse(page) {
    throw new Error('getFinalResponse not implemented');
  }

  async healthCheck(page) {
    try {
      await this.ensureReady(page);
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { BaseWebChatAdapter };
