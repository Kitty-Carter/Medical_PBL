class BaseWebChatAdapter {
  constructor(options = {}) {
    this.name = options.name || 'base_adapter';
    this.baseUrl = options.baseUrl || '';
    this.timeoutMs = Number(options.timeoutMs || 90000);
  }

  async ensureReady(_page) {
    throw new Error('ensureReady not implemented');
  }

  async sendPrompt(_page, _text) {
    throw new Error('sendPrompt not implemented');
  }

  async waitForStreamingStart(_page) {
    return true;
  }

  async readStreamingText(_page) {
    return '';
  }

  async waitForCompletion(_page) {
    return true;
  }

  async getFinalResponse(_page) {
    return '';
  }

  async abortGeneration(_page) {
    return false;
  }

  async healthCheck(page) {
    try {
      await this.ensureReady(page);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = { BaseWebChatAdapter };
