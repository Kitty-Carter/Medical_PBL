/**
 * 知识库模块 - 从 databases 文件夹加载 docx，构建向量检索
 * 若 mammoth/axios 未安装，则降级为无 RAG 模式，服务器仍可正常启动
 */
const fs = require('fs').promises;
const path = require('path');
let mammoth, axios;
try {
  mammoth = require('mammoth');
  axios = require('axios');
} catch (e) {
  mammoth = null;
  axios = null;
}

const API_KEY = process.env.LONGCAI_API_KEY || '';
const EMBEDDING_URL = 'https://api.longcat.chat/openai/v1/embeddings';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE = 512; // 约 512 tokens 的文本块
const TOP_K = 5;
const EMBEDDING_MAX_CHUNKS = 60;
const MAX_EMBED_FAILURES = 6;

let chunks = [];
let chunkTokens = [];
let chunkDf = new Map();
let vectorChunks = [];
let vectors = [];

/**
 * 简单按字符数估算 token（中文约1.5字符/token，英文约4字符/token）
 */
function estimateTokens(text) {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = text.length - chinese;
  return Math.ceil(chinese / 1.5 + other / 4);
}

/**
 * 智能分块：按句子/段落切分，避免语义断裂
 */
function splitIntoChunks(text) {
  const result = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  let currentTokens = 0;

  for (const p of paragraphs) {
    const tokens = estimateTokens(p);
    if (currentTokens + tokens > CHUNK_SIZE && current) {
      result.push(current.trim());
      current = '';
      currentTokens = 0;
    }
    current += (current ? '\n\n' : '') + p;
    currentTokens += tokens;
  }
  if (current.trim()) result.push(current.trim());

  if (result.length === 0 && text.trim()) result.push(text.trim());
  return result;
}

async function getEmbedding(text) {
  if (!API_KEY) throw new Error('未配置 LONGCAI_API_KEY');
  const res = await axios.post(
    EMBEDDING_URL,
    { model: EMBEDDING_MODEL, input: text },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );
  const data = res.data?.data?.[0]?.embedding;
  if (!data || !Array.isArray(data)) throw new Error('Embedding API 返回格式异常');
  return data;
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function tokenizeForLexical(text) {
  const terms = String(text || '').toLowerCase().match(/[a-z]{2,}|[一-龥]{2,8}/g) || [];
  return terms.filter((t) => t.length >= 2);
}

function rebuildLexicalIndex(allChunks) {
  chunks = allChunks;
  chunkTokens = allChunks.map((c) => tokenizeForLexical(c));
  chunkDf = new Map();
  chunkTokens.forEach((tokens) => {
    const uniq = new Set(tokens);
    uniq.forEach((t) => chunkDf.set(t, (chunkDf.get(t) || 0) + 1));
  });
}

function lexicalScore(queryTokens, tokens, totalDocs) {
  if (!queryTokens.length || !tokens.length || totalDocs <= 0) return 0;
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const q of queryTokens) {
    const qtf = tf.get(q) || 0;
    if (!qtf) continue;
    const df = chunkDf.get(q) || 1;
    const idf = Math.log(1 + (totalDocs + 1) / (df + 1));
    score += (1 + Math.log(1 + qtf)) * idf;
  }
  return score;
}

async function readFileTextByType(filePath, ext) {
  if (ext === '.docx') {
    const buffer = await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer });
    return value || '';
  }
  if (ext === '.txt' || ext === '.md') {
    return await fs.readFile(filePath, 'utf8');
  }
  return '';
}

async function collectSupportedFiles(dirPath) {
  const files = await fs.readdir(dirPath);
  return files
    .filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ext === '.docx' || ext === '.txt' || ext === '.md';
    })
    .map((f) => path.join(dirPath, f));
}

/**
 * 加载 databases 目录下 docx/txt/md
 */
async function loadKnowledgeBase() {
  if (!mammoth || !axios) {
    console.warn('[知识库] mammoth/axios 未安装，跳过 RAG。请执行 npm install 安装依赖。');
    return;
  }
  const primaryDbDir = path.join(__dirname, '..', 'databases');
  const mirrorDbDir = path.join(__dirname, '..', 'Medical_PBL', 'databases');
  const candidateDirs = [primaryDbDir, mirrorDbDir];
  const filePaths = [];

  for (const dir of candidateDirs) {
    try {
      await fs.access(dir);
      const supported = await collectSupportedFiles(dir);
      filePaths.push(...supported);
    } catch (_) {}
  }

  if (filePaths.length === 0) {
    console.warn('[知识库] 未发现可用知识库文件（docx/txt/md）');
    chunks = [];
    chunkTokens = [];
    chunkDf = new Map();
    vectorChunks = [];
    vectors = [];
    return;
  }

  const allChunks = [];
  for (const fp of filePaths) {
    const ext = path.extname(fp).toLowerCase();
    try {
      const value = await readFileTextByType(fp, ext);
      if (!value?.trim()) continue;
      const textChunks = splitIntoChunks(value);
      for (const c of textChunks) {
        if (c.length > 20) allChunks.push(c);
      }
    } catch (e) {
      console.warn(`[知识库] 解析 ${path.basename(fp)} 失败:`, e.message);
    }
  }

  if (allChunks.length === 0) {
    chunks = [];
    chunkTokens = [];
    chunkDf = new Map();
    vectorChunks = [];
    vectors = [];
    return;
  }

  // 无论是否可向量化，先建立词法检索索引，确保可用性与可解释性
  rebuildLexicalIndex(allChunks);

  if (!API_KEY) {
    vectorChunks = [];
    vectors = [];
    console.warn('[知识库] 未配置 LONGCAI_API_KEY，已启用词法检索模式');
    console.log(`[知识库] 已加载 ${chunks.length} 个文本块`);
    return;
  }

  const vecs = [];
  const vecTexts = [];
  let failed = 0;
  const forEmbedding = allChunks.slice(0, EMBEDDING_MAX_CHUNKS);
  for (let i = 0; i < forEmbedding.length; i++) {
    try {
      const vec = await getEmbedding(forEmbedding[i]);
      vecs.push(vec);
      vecTexts.push(forEmbedding[i]);
      failed = 0;
    } catch (e) {
      failed += 1;
      console.warn(`[知识库] 获取第 ${i + 1} 块 embedding 失败:`, e.message);
      if (failed >= MAX_EMBED_FAILURES) {
        console.warn('[知识库] embedding 服务连续失败，提前切换词法检索，避免阻塞启动');
        break;
      }
    }
  }

  vectorChunks = vecTexts;
  vectors = vecs;
  console.log(`[知识库] 已加载 ${chunks.length} 个文本块（向量块: ${vectors.length}）`);
}

/**
 * 检索与查询最相关的文本块
 */
async function retrieve(queryText, k = TOP_K) {
  if (!chunks.length) return [];

  const queryTokens = tokenizeForLexical(queryText);
  const lexicalScored = chunks.map((c, i) => ({
    text: c,
    score: lexicalScore(queryTokens, chunkTokens[i] || [], chunks.length),
  }));
  lexicalScored.sort((a, b) => b.score - a.score);
  const lexicalTop = lexicalScored.filter((x) => x.score > 0).slice(0, Math.max(k, 3));

  if (!axios || !vectors.length) {
    return lexicalTop.slice(0, k).map((x) => x.text);
  }

  try {
    const queryVec = await getEmbedding(queryText);
    const vectorScored = vectorChunks.map((c, i) => ({
      text: c,
      score: cosineSimilarity(queryVec, vectors[i]),
    }));
    vectorScored.sort((a, b) => b.score - a.score);
    const vectorTop = vectorScored.filter((x) => x.score > 0.25).slice(0, Math.max(k, 3));

    const merged = new Map();
    vectorTop.forEach((x, idx) => {
      merged.set(x.text, 2 - idx * 0.1);
    });
    lexicalTop.forEach((x, idx) => {
      merged.set(x.text, (merged.get(x.text) || 0) + (1 - idx * 0.05));
    });
    return Array.from(merged.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([text]) => text);
  } catch (e) {
    console.warn('[知识库] 向量检索失败，回退词法检索:', e.message);
    return lexicalTop.slice(0, k).map((x) => x.text);
  }
}

module.exports = {
  loadKnowledgeBase,
  retrieve,
};
