const fs = require('fs').promises;
const path = require('path');
const mammoth = require('mammoth');
const { pblConfig } = require('../config');

const SUPPORTED_EXT = new Set(['.docx', '.md', '.txt', '.json']);

async function walk(dir) {
  let out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = await walk(fp);
      out = out.concat(nested);
    } else {
      out.push(fp);
    }
  }
  return out;
}

function extractKeywords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z]{3,}|[一-龥]{2,8}/g) || [];
  const freq = new Map();
  words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

function chunkText(text, size = 900, overlap = 180) {
  const src = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!src) return [];
  const chunks = [];
  let i = 0;
  while (i < src.length) {
    const end = Math.min(src.length, i + size);
    chunks.push(src.slice(i, end));
    if (end >= src.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

async function readText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const buffer = await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer });
    return value || '';
  }
  const raw = await fs.readFile(filePath, 'utf8');
  if (ext === '.json') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (_) {
      return raw;
    }
  }
  return raw;
}

function reliabilityByPath(relPath) {
  if (relPath.includes('lesson_summaries')) return 'lesson_summary';
  if (relPath.endsWith('.docx') || relPath.endsWith('.md') || relPath.endsWith('.txt') || relPath.endsWith('.json')) {
    return 'internal_doc';
  }
  return 'unknown';
}

async function buildEvidenceIndex({ force = false } = {}) {
  const indexPath = pblConfig.evidenceIndexPath;
  let prev = { files: {}, chunks: [] };
  if (!force) {
    try {
      prev = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    } catch (_) {}
  }

  const files = await walk(pblConfig.databasesDir);
  const nextFiles = {};
  const chunks = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) continue;
    const stat = await fs.stat(filePath);
    const rel = path.relative(pblConfig.databasesDir, filePath).replace(/\\/g, '/');
    const mtimeMs = stat.mtimeMs;
    nextFiles[rel] = { mtimeMs };
    const unchanged = prev.files?.[rel]?.mtimeMs === mtimeMs;
    if (unchanged) {
      const keep = (prev.chunks || []).filter((c) => c.source === rel);
      chunks.push(...keep);
      continue;
    }
    const text = await readText(filePath);
    const cks = chunkText(text, 900, 200);
    const title = path.basename(filePath, ext);
    cks.forEach((ck, idx) => {
      const chunkId = `${path.basename(filePath)}#${idx + 1}`;
      chunks.push({
        source: rel,
        title,
        chunkId,
        excerpt: ck.slice(0, 520),
        content: ck,
        keywords: extractKeywords(ck),
        reliability: reliabilityByPath(rel),
        modifiedAt: stat.mtime.toISOString(),
      });
    });
  }

  const index = {
    updatedAt: new Date().toISOString(),
    files: nextFiles,
    chunks,
  };
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
  return index;
}

async function readEvidenceIndex() {
  try {
    return JSON.parse(await fs.readFile(pblConfig.evidenceIndexPath, 'utf8'));
  } catch (_) {
    return buildEvidenceIndex({ force: true });
  }
}

module.exports = {
  buildEvidenceIndex,
  readEvidenceIndex,
};
