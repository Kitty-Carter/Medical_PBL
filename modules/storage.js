const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');
const { buildTeachingRecommendations } = require('./recommendationEngine');
const { sanitizeFileName, ensureInside } = require('./safePath');
const crypto = require('crypto');

function getRecordsRoot() {
  return path.resolve(process.env.RECORDS_ROOT || path.join(__dirname, '..', 'Medical_PBL', 'records'));
}

function buildRecordId(date, teacherName, roomCode) {
  const dateStr = date.toISOString().split('T')[0];
  const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
  const safeTeacher = safePathSegment(teacherName, 'unknown');
  const safeRoom = safePathSegment(roomCode, 'unknown');
  return `${dateStr}_${timeStr}_${safeTeacher}_${safeRoom}`;
}

function safePathSegment(input, fallback = 'unknown') {
  if (input === null || input === undefined) return fallback;
  const str = String(input).trim();
  if (!str) return fallback;
  // 替换 Windows/Linux 非法路径字符
  let safe = str.replace(/[<>:"|?*\x00-\x1f]/g, '');
  // 替换路径遍历字符
  safe = safe.replace(/\.\./g, '');
  safe = safe.replace(/[\/\\]/g, '_');
  // 长度限制
  return safe.slice(0, 80) || fallback;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  return str.replace(/[&<>"'\/]/g, (m) => map[m]);
}

function createDownloadToken() {
  return crypto.randomBytes(24).toString('hex');
}

function formatDirStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function buildTeacherFriendlyHtml(teacherName, date, analysis) {
  const safeTeacherName = escapeHtml(teacherName);
  const safeDate = escapeHtml(date);
  
  const scoreRows = (analysis.scoreTable || [])
    .map((r) => `<tr><td>${escapeHtml(r.studentId)}</td><td>${escapeHtml(r.name)}</td><td>${r.messageCount}</td><td>${r.machineScore}</td><td>${r.teacherScore}</td><td>${r.finalScore}</td></tr>`)
    .join('');
  const coRows = (analysis.keywordCooccurrence || [])
    .slice(0, 15)
    .map((r) => `<tr><td>${escapeHtml(r.source)}</td><td>${escapeHtml(r.target)}</td><td>${r.count}</td><td>${escapeHtml(r.strength ?? '')}</td></tr>`)
    .join('');
  const kws = (analysis.keywords || []).slice(0, 20).map((k) => `${escapeHtml(k.word)}(${k.count})`).join('、');
  const stats = analysis.statistics || {};
  const recs = buildTeachingRecommendations(analysis);
  const recHtml = recs.map((r, i) => `<p class="hint">${i + 1}. ${escapeHtml(r)}</p>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><title>课堂详细分析报告</title><style>
body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#1f2937}h1,h2{margin:0 0 12px}.meta{margin-bottom:20px;color:#4b5563}.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;font-size:14px}th{background:#f3f4f6}.hint{color:#374151;line-height:1.7}
</style></head><body><h1>课堂详细分析报告</h1><div class="meta">教师：${safeTeacherName} ｜ 日期：${safeDate}</div>
<div class="card"><h2>一、评分总览</h2><table><tr><th>学号</th><th>姓名</th><th>发言次数</th><th>机器评分</th><th>教师评分</th><th>最终成绩</th></tr>${scoreRows || '<tr><td colspan="6">暂无数据</td></tr>'}</table></div>
<div class="card"><h2>二、统计指标</h2><p class="hint">机器均分：${stats.avgMachine ?? 0}；教师均分：${stats.avgTeacher ?? 0}；评分偏差(MAE)：${stats.scoreGapMAE ?? 0}<br/>平均提问率：${stats.askRate ?? 0}%；AI回应率：${stats.aiResponseRate ?? 0}%；参与度标准差：${stats.participationStd ?? 0}</p></div>
<div class="card"><h2>三、关键词与共线关系</h2><p class="hint">关键词：${kws || '暂无关键词'}</p><table><tr><th>关键词A</th><th>关键词B</th><th>共现次数</th><th>强度</th></tr>${coRows || '<tr><td colspan="4">暂无共线数据</td></tr>'}</table></div>
<div class="card"><h2>四、阅读建议（给教师）</h2>${recHtml}</div></body></html>`;
}

async function writeJson(file, data) {
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function createArchiveZip(recordsDir, archivePath) {
  ensureInside(getRecordsRoot(), recordsDir);
  ensureInside(getRecordsRoot(), archivePath);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(recordsDir, false);
    archive.finalize();
  });
}

async function buildManifest(recordsDir, meta) {
  const names = await fsp.readdir(recordsDir);
  const files = [];
  for (const name of names) {
    const stat = await fsp.stat(path.join(recordsDir, name));
    if (stat.isFile() && name !== 'manifest.json') files.push({ name, size: stat.size });
  }
  return { ...meta, files };
}

function shouldWriteCompatRecords() {
  return String(process.env.KEEP_COMPAT_RECORDS || '').toLowerCase() === 'true';
}

async function saveRoomRecords(teacherName, date, csvBuffer, docxBuffer, analysisJson, transcriptText = '', options = {}) {
  const closedAt = options.closedAt ? new Date(options.closedAt) : new Date();
  const recordsRoot = getRecordsRoot();
  const downloadToken = options.downloadToken || createDownloadToken();
  const recordId = options.recordId || buildRecordId(closedAt, teacherName, options.roomCode);
  const recordsDir = ensureInside(recordsRoot, path.join(recordsRoot, recordId));
  await fsp.mkdir(recordsDir, { recursive: true });

  const roomCode = safePathSegment(options.roomCode || analysisJson.roomCode || 'unknown', 'room', 20);
  const detailPack = {
    recordId,
    roomCode,
    teacherName,
    date,
    closedAt: closedAt.toISOString(),
    tabs: {
      scores: analysisJson.scoreTable || [],
      participation: analysisJson.participation || [],
      questions: analysisJson.questionStats || {},
      keywords: analysisJson.keywords || [],
      cooccurrence: analysisJson.keywordCooccurrence || [],
      timeDistribution: analysisJson.timeDistributionMinutes || [],
      scoreComparison: analysisJson.scoreComparison || {},
      statistics: analysisJson.statistics || {},
    },
  };

  // 保存所有文件到主目录
  await fsp.writeFile(path.join(recordsDir, 'scores.csv'), csvBuffer);
  await fsp.writeFile(path.join(recordsDir, 'discussion.docx'), docxBuffer);
  await fsp.writeFile(path.join(recordsDir, 'transcript.txt'), transcriptText || '', 'utf8');
  await writeJson(path.join(recordsDir, 'analysis.json'), analysisJson);
  await writeJson(path.join(recordsDir, '详细分析数据包.json'), detailPack);
  await writeJson(path.join(recordsDir, 'question_stats.json'), analysisJson.questionStats || {});
  await writeJson(path.join(recordsDir, 'cooccurrence.json'), analysisJson.keywordCooccurrence || []);
  await writeJson(path.join(recordsDir, 'time_distribution_minutes.json'), analysisJson.timeDistributionMinutes || []);
  await writeJson(path.join(recordsDir, 'score_comparison.json'), analysisJson.scoreComparison || {});
  await writeJson(path.join(recordsDir, 'statistics.json'), analysisJson.statistics || {});
  await fsp.writeFile(path.join(recordsDir, '详细分析报告.html'), buildTeacherFriendlyHtml(teacherName, date, analysisJson), 'utf8');
  await fsp.writeFile(path.join(recordsDir, '使用说明.txt'), 'scores.csv 为成绩表，discussion.docx 为课堂记录，transcript.txt 为纯文本转录，详细分析报告.html 可直接用浏览器查看。', 'utf8');

  // 创建 manifest
  let manifest = await buildManifest(recordsDir, { 
    recordId, 
    teacherName, 
    date, 
    roomCode,
    createdAt: closedAt.toISOString(),
    archiveFilename: '完整课堂记录包.zip',
    downloadToken 
  });
  await writeJson(path.join(recordsDir, 'manifest.json'), manifest);

  // 创建 archive.zip 在记录目录内部
  const archivePath = path.join(recordsDir, 'archive.zip');
  await createArchiveZip(recordsDir, archivePath);
  const zipStat = await fsp.stat(archivePath);
  
  // 更新 manifest 包含 archive.zip
  manifest.files.push({ name: 'archive.zip', size: zipStat.size });
  await writeJson(path.join(recordsDir, 'manifest.json'), manifest);

  // 兼容目录写入（可选）
  if (shouldWriteCompatRecords()) {
    try {
      const compatRoot = path.join(__dirname, '..', 'records');
      const medicalCompatRoot = path.join(__dirname, '..', 'Medical_PBL', 'records');
      
      for (const compatDir of [compatRoot, medicalCompatRoot]) {
        await fsp.mkdir(compatDir, { recursive: true });
        const compatRecordsDir = ensureInside(compatDir, path.join(compatDir, recordId));
        await fsp.mkdir(compatRecordsDir, { recursive: true });
        
        // 复制文件
        const files = await fsp.readdir(recordsDir);
        for (const file of files) {
          const srcPath = path.join(recordsDir, file);
          const destPath = path.join(compatRecordsDir, file);
          await fsp.copyFile(srcPath, destPath);
        }
      }
    } catch (e) {
      console.warn('[storage][compat] 兼容目录写入失败:', e.message);
    }
  }

  return {
    recordId,
    recordsRoot,
    recordsDir,
    archivePath,
    archiveFilename: 'archive.zip',
    manifestPath: path.join(recordsDir, 'manifest.json'),
    files: manifest.files,
    downloadToken,
    createdAt: closedAt.toISOString()
  };
}

async function listRecords(limit = 50) {
  const recordsRoot = getRecordsRoot();
  await fsp.mkdir(recordsRoot, { recursive: true });
  const entries = await fsp.readdir(recordsRoot, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifestPath = ensureInside(recordsRoot, path.join(recordsRoot, entry.name, 'manifest.json'));
      const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      records.push({ ...manifest, downloadUrl: `/api/records/${encodeURIComponent(manifest.recordId)}/download` });
    } catch (_) {}
  }
  return records.sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, limit);
}

async function findRecord(recordId) {
  const recordsRoot = getRecordsRoot();
  const records = await listRecords(2000);
  const manifest = records.find((r) => r.recordId === recordId);
  if (!manifest) return null;
  const entries = await fsp.readdir(recordsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifestPath = ensureInside(recordsRoot, path.join(recordsRoot, entry.name, 'manifest.json'));
      const item = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      if (item.recordId === recordId) {
        const recordsDir = ensureInside(recordsRoot, path.join(recordsRoot, entry.name));
        const zipPath = ensureInside(recordsRoot, path.join(recordsRoot, `record_${recordId}.zip`));
        return { manifest: item, recordsRoot, recordsDir, zipPath };
      }
    } catch (_) {}
  }
  return null;
}

module.exports = saveRoomRecords;
module.exports.getRecordsRoot = getRecordsRoot;
module.exports.listRecords = listRecords;
module.exports.findRecord = findRecord;
module.exports.createArchiveZip = createArchiveZip;
module.exports.safePathSegment = safePathSegment;
module.exports.escapeHtml = escapeHtml;
module.exports.buildRecordId = buildRecordId;
module.exports.createDownloadToken = createDownloadToken;
