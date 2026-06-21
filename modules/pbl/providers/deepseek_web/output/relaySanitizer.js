function sanitizeRelayText(text = '') {
  let out = String(text || '').trim();
  out = out.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/\*\*|__|~~/g, '');
  if (out.length > 2200) out = out.slice(0, 2200);
  return out.trim();
}

module.exports = {
  sanitizeRelayText,
};
