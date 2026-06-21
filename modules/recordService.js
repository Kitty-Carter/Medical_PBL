const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const archiver = require('archiver');
const { buildTeachingRecommendations } = require('./recommendationEngine');
const { safeFileName, ensureInside } = require('./safePath');

function getRecordsRoot() {
  return path.resolve(process.env.PBL_RECORDS_DIR || path.join(process.cwd(), 'records'));
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatLocalDateParts(date = new Date()) {
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    stamp: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  };
}

function buildTeacherFriendlyHtml(teacherName, date, analysis) {
  const scoreRows = (analysis.scoreTable || [])
    .map((r) => `<tr><td>${r.studentId}</td><td>${r.name}</td><td>${r.messageCount}</td><td>${r.machineScore}</td><td>${r.teacherScore}</td><td>${r.finalScore}</td></tr>`)
    .join('');
  const coRows = (analysis.keywordCooccurrence || []).slice(0, 15)
    .map((r) => `<tr><td>${r.source}</td><td>${r.target}</td><td>${r.count}</td><td>${r.strength ?? ''}</td></tr>`).join('');
  const kws = (analysis.keywords || []).slice(0, 20).map((k) => `${k.word}(${k.count})`).join('、');
  const stats = analysis.statistics || {};
  const recHtml = buildTeachingRecommendations(analysis).map((r, i) => `<p class="hint">${i + 1}. ${r}</p>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>课堂详细分析报告</title><style>body{font-family:"Microsoft YaHei",Arial,sans-serif;margin:24px;color:#1f2937}.meta{margin-bottom:20px;color:#4b5563}.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;font-size:14px}th{background:#f3f4f6}.hint{color:#374151;line-height:1.7}</style></head><body><h1>课堂详细分析报告</h1><div class="meta">教师：${teacherName} ｜ 日期：${date}</div><div class="card"><h2>一、评分总览</h2><table><tr><th>学号</th><th>姓名</th><th>发言次数</th><th>机器评分</th><th>教师评分</th><th>最终成绩</th></tr>${scoreRows || '<tr><td colspan="6">暂无数据</td></tr>'}</table></div><div class="card"><h2>二、统计指标</h2><p class="hint">机器均分：${stats.avgMachine ?? 0}；教师均分：${stats.avgTeacher ?? 0}；评分偏差(MAE)：${stats.scoreGapMAE ?? 0}<br/>平均提问率：${stats.askRate ?? 0}%；AI回应率：${stats.aiResponseRate ?? 0}%；参与度标准差：${stats.participationStd ?? 0}</p></div><div class="card"><h2>三、关键词与共线关系</h2><p class="hint">关键词：${kws || '暂无关键词'}</p><table><tr><th>关键词A</th><th>关键词B</th><th>共现次数</th><th>强度</th></tr>${coRows || '<tr><td colspan="4">暂无共线数据</td></tr>'}</table></div><div class="card"><h2>四、阅读建议（给教师）</h2>${recHtml}</div></body></html>`;
}

async function zipDirectory(sourceDir, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function saveRoomRecords(room, date, csvBuffer, docxBuffer, analysisJson, transcriptText = '') {
  const closedAt = new Date();
  const parts = formatLocalDateParts(closedAt);
  const teacherName = room.teacherName || analysisJson.teacherName || '未知教师';
  const roomCode = String(room.roomCode || analysisJson.roomCode || 'unknown');
  const safeTeacher = safeFileName(teacherName, '未知教师', 40);
  const recordId = `${parts.stamp}_room-${safeFileName(roomCode, 'room', 20)}_${safeTeacher}`.slice(0, 120);
  const recordsRoot = getRecordsRoot();
  const recordsDir = ensureInside(recordsRoot, path.join(recordsRoot, recordId));
  await fs.mkdir(recordsDir, { recursive: true });

  const detailPack = { teacherName, roomCode, date: parts.date, tabs: { scores: analysisJson.scoreTable || [], participation: analysisJson.participation || [], questions: analysisJson.questionStats || {}, keywords: analysisJson.keywords || [], cooccurrence: analysisJson.keywordCooccurrence || [], timeDistribution: analysisJson.timeDistributionMinutes || [], scoreComparison: analysisJson.scoreComparison || {}, statistics: analysisJson.statistics || {} } };
  const files = [
    ['scores.csv', csvBuffer],
    ['discussion.docx', docxBuffer],
    ['transcript.txt', transcriptText || ''],
    ['analysis.json', JSON.stringify(analysisJson, null, 2)],
    ['详细分析数据包.json', JSON.stringify(detailPack, null, 2)],
    ['question_stats.json', JSON.stringify(analysisJson.questionStats || {}, null, 2)],
    ['cooccurrence.json', JSON.stringify(analysisJson.keywordCooccurrence || [], null, 2)],
    ['time_distribution_minutes.json', JSON.stringify(analysisJson.timeDistributionMinutes || [], null, 2)],
    ['score_comparison.json', JSON.stringify(analysisJson.scoreComparison || {}, null, 2)],
    ['statistics.json', JSON.stringify(analysisJson.statistics || {}, null, 2)],
    ['详细分析报告.html', buildTeacherFriendlyHtml(teacherName, parts.date, analysisJson)],
    ['README.txt', '请双击“详细分析报告.html”查看图文版分析。scores.csv 为成绩表，discussion.docx 为课堂记录，analysis.json 为原始分析数据。'],
  ];
  for (const [name, content] of files) {
    await fs.writeFile(path.join(recordsDir, name), content, Buffer.isBuffer(content) ? undefined : 'utf8');
  }

  const manifest = { recordId, roomCode, teacherName, date: parts.date, closedAt: closedAt.toISOString(), files: [] };
  for (const [name] of files) {
    const stat = await fs.stat(path.join(recordsDir, name));
    manifest.files.push({ name, size: stat.size });
  }
  await fs.writeFile(path.join(recordsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  manifest.files.push({ name: 'manifest.json', size: (await fs.stat(path.join(recordsDir, 'manifest.json'))).size });
  await fs.writeFile(path.join(recordsDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const zipPath = ensureInside(recordsRoot, path.join(recordsRoot, `record_${recordId}.zip`));
  await zipDirectory(recordsDir, zipPath);
  return { recordId, recordsRoot, recordsDir, zipPath, downloadUrl: `/api/records/${encodeURIComponent(recordId)}/download`, manifest };
}

async function listRecords(limit = 50) {
  const recordsRoot = getRecordsRoot();
  await fs.mkdir(recordsRoot, { recursive: true });
  const entries = await fs.readdir(recordsRoot, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(recordsRoot, entry.name, 'manifest.json'), 'utf8'));
      records.push({ ...manifest, downloadUrl: `/api/records/${encodeURIComponent(manifest.recordId)}/download` });
    } catch (_) {}
  }
  return records.sort((a, b) => Date.parse(b.closedAt || 0) - Date.parse(a.closedAt || 0)).slice(0, limit);
}

async function findRecord(recordId) {
  const safeId = safeFileName(recordId, '', 140);
  if (!safeId || safeId !== String(recordId || '')) return null;
  const recordsRoot = getRecordsRoot();
  const recordsDir = ensureInside(recordsRoot, path.join(recordsRoot, safeId));
  const manifest = JSON.parse(await fs.readFile(path.join(recordsDir, 'manifest.json'), 'utf8'));
  const zipPath = ensureInside(recordsRoot, path.join(recordsRoot, `record_${safeId}.zip`));
  return { recordsRoot, recordsDir, zipPath, manifest };
}

module.exports = { saveRoomRecords, listRecords, findRecord, zipDirectory, getRecordsRoot };
