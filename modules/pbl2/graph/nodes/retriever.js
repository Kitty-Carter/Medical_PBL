// 节点6: retrieve_evidence - 从 databases 检索证据（简化 BM25）
const fs = require('fs');
const path = require('path');

// 简化的 BM25 检索（TF-IDF 粗略实现）
function retrieveEvidence(graphState) {
  const { turnPlan } = graphState;
  
  // 提取查询关键词
  const keywords = extractKeywords(turnPlan);
  
  if (keywords.length === 0) {
    return { evidenceSnippets: [] };
  }

  // 读取证据索引（如果存在）
  const indexPath = path.join(process.cwd(), 'databases', '.pbl_evidence_index.json');
  let index = { chunks: [] };
  
  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch (e) {
    console.warn('[retrieveEvidence] 索引读取失败:', e.message);
  }

  // 简单打分并排序
  const scored = index.chunks.map(chunk => {
    let score = 0;
    keywords.forEach(kw => {
      if (chunk.text && chunk.text.includes(kw)) {
        score += 1;
      }
    });
    return { ...chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const topK = scored.slice(0, 5).filter(c => c.score > 0);

  return {
    evidenceSnippets: topK.map(c => ({
      text: c.text?.slice(0, 300) || '',
      source: c.source || 'unknown',
      score: c.score,
    })),
  };
}

function extractKeywords(turnPlan) {
  const keywords = [];
  
  // 从 keyFactCluster 提取
  if (turnPlan.keyFactCluster) {
    turnPlan.keyFactCluster.forEach(fact => {
      // 提取医学术语（简化：取中文词组）
      const matches = fact.match(/[\u4e00-\u9fa5]{2,}/g);
      if (matches) {
        keywords.push(...matches);
      }
    });
  }

  // 从 mainContradiction 提取
  if (turnPlan.mainContradiction) {
    const matches = turnPlan.mainContradiction.match(/[\u4e00-\u9fa5]{2,}/g);
    if (matches) {
      keywords.push(...matches);
    }
  }

  return [...new Set(keywords)].slice(0, 10);
}

module.exports = { retrieveEvidence };
