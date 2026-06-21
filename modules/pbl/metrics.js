const WINDOW = 50;

const bucket = {
  parseFailed: [],
  technicalFallback: [],
  legacyTemplateFallback: [],
};

function pushWin(arr, v) {
  arr.push(v ? 1 : 0);
  if (arr.length > WINDOW) arr.shift();
}

function rate(arr) {
  if (!arr.length) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Number((sum / arr.length).toFixed(3));
}

function recordMetrics({ parseFailed, technicalFallback, legacyTemplateFallback }) {
  pushWin(bucket.parseFailed, !!parseFailed);
  pushWin(bucket.technicalFallback, !!technicalFallback);
  pushWin(bucket.legacyTemplateFallback, !!legacyTemplateFallback);
}

function getMetrics() {
  return {
    window: WINDOW,
    roleDraft_parse_failed_rate: rate(bucket.parseFailed),
    technical_fallback_rate: rate(bucket.technicalFallback),
    legacy_template_fallback_rate: rate(bucket.legacyTemplateFallback),
  };
}

module.exports = {
  recordMetrics,
  getMetrics,
};
