function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(baseMs = 250) {
  return Math.floor(Math.random() * baseMs);
}

function parseRetryAfterMs(err) {
  const fromData = err?.response?.data?.error?.retry_after;
  const fromHeader = err?.response?.headers?.['retry-after'];
  const sec = Number(fromData ?? fromHeader);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return null;
}

async function withRateLimitRetry(run, options = {}) {
  const {
    maxRetries = 4,
    onRetry = () => {},
    retryNetworkOnce = true,
  } = options;
  let attempt = 0;
  let networkRetried = false;

  while (true) {
    try {
      return await run(attempt);
    } catch (err) {
      const status = err?.response?.status;
      const is429 = status === 429;
      const isNetwork = !status;
      if (is429 && attempt < maxRetries) {
        const retryAfterMs = parseRetryAfterMs(err);
        const expo = Math.pow(2, attempt) * 1000;
        const waitMs = (retryAfterMs != null ? retryAfterMs : expo) + randomJitter(350);
        onRetry({ attempt, waitMs, reason: '429' });
        await sleep(waitMs);
        attempt += 1;
        continue;
      }
      if (isNetwork && retryNetworkOnce && !networkRetried) {
        networkRetried = true;
        const waitMs = 700 + randomJitter(300);
        onRetry({ attempt, waitMs, reason: 'network' });
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

module.exports = {
  withRateLimitRetry,
};
