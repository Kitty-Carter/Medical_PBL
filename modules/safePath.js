const path = require('path');

function sanitizeFileName(input, fallback = 'file', maxLength = 80) {
  const cleaned = String(input || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
}

function ensureInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('非法路径');
  }
  return resolvedTarget;
}

module.exports = { sanitizeFileName, ensureInside };
