const { sanitizeResponse } = require('./relaySanitizer');

async function readRelayResponse({ adapter, page, maxWaitMs, abortSignal }) {
  const waitPromise = adapter.waitForCompletion(page, maxWaitMs);
  const abortPromise = new Promise((_, reject) => {
    if (!abortSignal) return;
    if (abortSignal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  await Promise.race([waitPromise, abortPromise]);
  const text = await adapter.getFinalResponse(page);
  return sanitizeResponse(text);
}

module.exports = {
  readRelayResponse,
};
