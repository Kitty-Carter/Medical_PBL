function sanitizePrompt(prompt = '') {
  return String(prompt || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim();
}

function summarizePrompt(prompt = '', max = 180) {
  const p = sanitizePrompt(prompt).replace(/\s+/g, ' ');
  return p.length > max ? `${p.slice(0, max)}...` : p;
}

function sanitizeResponse(text = '') {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  sanitizePrompt,
  summarizePrompt,
  sanitizeResponse,
};
