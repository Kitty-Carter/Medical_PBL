const fs = require('fs').promises;
const path = require('path');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  const root = path.join(__dirname, '..');
  const checks = [];
  const requiredPaths = [
    'server.js',
    'public/index.html',
    'modules/analyzer.js',
    'modules/knowledgeBase.js',
    'modules/storage.js',
    'databases',
    'Medical_PBL/records',
  ];

  for (const rel of requiredPaths) {
    const ok = await exists(path.join(root, rel));
    checks.push({ item: rel, ok, message: ok ? 'OK' : '缺失' });
  }

  const passCount = checks.filter((c) => c.ok).length;
  const score = Math.round((passCount / checks.length) * 100);
  const report = {
    createdAt: new Date().toISOString(),
    score,
    passed: passCount,
    total: checks.length,
    checks,
  };

  const outDir = path.join(root, 'Medical_PBL', 'records', '_quality');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `quality-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(`质量门禁评分: ${score} (${passCount}/${checks.length})`);
  console.log(`报告输出: ${outFile}`);
  if (score < 80) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[quality-gate]', err);
  process.exitCode = 1;
});

