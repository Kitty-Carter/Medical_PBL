const ss = require('simple-statistics');
const { normalizeStudentScores, calculateMachineAttitudeScore, calculateRuleBasedThinkingScore } = require('./pbl2/scoring');

const QUESTION_RE = /[?？]|为什么|为何|如何|怎么|是否|吗|呢|哪种|哪一个/;

function getMsgTime(msg) {
  if (typeof msg?.time === 'number' && Number.isFinite(msg.time)) return msg.time;
  if (typeof msg?.timestamp === 'string') {
    const parsed = Date.parse(msg.timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sortByStudentId(a, b) {
  const an = Number(a.studentId);
  const bn = Number(b.studentId);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a.studentId).localeCompare(String(b.studentId));
}

function round(value, digits = 3) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function extractKeywords(text) {
  const stopWords = new Set([
    '的', '了', '是', '在', '有', '和', '与', '或', '及', '等', '这', '那', '我', '你', '他', '她', '我们',
    '可以', '进行', '认为', '觉得', '可能', '应该', '需要', '如何', '什么', '为什么', '怎么', '一个', '一种',
    '一些', '患者', '疾病', '治疗', '诊断', '检查',
  ]);
  const words = text.match(/[A-Za-z]{3,}|[一-龥]{2,8}/g) || [];
  return words.filter((w) => !stopWords.has(w));
}

function safePearson(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 2) return null;
  try {
    const corr = ss.sampleCorrelation(x, y);
    return Number.isFinite(corr) ? corr : null;
  } catch (_) {
    return null;
  }
}

function safeSpearman(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 2) return null;
  try {
    const corr = ss.sampleRankCorrelation(x, y);
    return Number.isFinite(corr) ? corr : null;
  } catch (_) {
    return null;
  }
}

function safeConcordanceCorrelation(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 2) return null;
  const mx = ss.mean(x);
  const my = ss.mean(y);
  const vx = ss.variance(x);
  const vy = ss.variance(y);
  const cov = ss.sampleCovariance(x, y);
  const denom = vx + vy + ((mx - my) ** 2);
  if (!Number.isFinite(denom) || denom === 0) return null;
  const ccc = (2 * cov) / denom;
  return Number.isFinite(ccc) ? ccc : null;
}

function buildStudentMetrics(room, studentId) {
  const textMessages = (room.messages || []).filter((m) => m.type === 'text');
  const studentMsgs = [];
  let totalChars = 0;
  let questionCount = 0;
  let aiReplyCount = 0;
  let peerReplyCount = 0;
  let answeredWindowCount = 0;
  const keywordSet = new Set();
  let firstTime = null;
  let lastTime = null;

  textMessages.forEach((m, idx) => {
    if (m.sender?.id !== studentId) return;
    const content = m.content || '';
    studentMsgs.push(m);
    totalChars += content.length;
    if (QUESTION_RE.test(content)) {
      questionCount += 1;
      const lookahead = textMessages.slice(idx + 1, idx + 4);
      const aiHit = lookahead.some((x) => x?.sender?.role?.startsWith?.('ai_'));
      const peerHit = lookahead.some((x) => x?.sender?.id && x.sender.id !== studentId && !x.sender?.role?.startsWith?.('ai_'));
      if (aiHit) aiReplyCount += 1;
      if (peerHit) peerReplyCount += 1;
      if (aiHit || peerHit) {
        answeredWindowCount += 1;
      }
    }
    extractKeywords(content).forEach((k) => keywordSet.add(k));

    const t = getMsgTime(m);
    if (t != null) {
      if (firstTime == null || t < firstTime) firstTime = t;
      if (lastTime == null || t > lastTime) lastTime = t;
    }
  });

  const count = studentMsgs.length;
  const avgChars = count > 0 ? totalChars / count : 0;
  const questionRate = count > 0 ? questionCount / count : 0;
  const replyRate = questionCount > 0 ? aiReplyCount / questionCount : 0;
  const peerReplyRate = questionCount > 0 ? peerReplyCount / questionCount : 0;
  const activeSpanMin = (firstTime != null && lastTime != null && lastTime >= firstTime)
    ? (lastTime - firstTime) / 60000
    : 0;

  return {
    count,
    totalChars,
    avgChars,
    questionCount,
    aiReplyCount,
    peerReplyCount,
    answeredWindowCount,
    questionRate,
    replyRate,
    peerReplyRate,
    keywordDiversity: keywordSet.size,
    activeSpanMin,
  };
}

function machineScore(input, maybeName = '') {
  if (typeof input === 'number') {
    const count = input;
    if (count === 0) return 0;
    const simple = 55 + Math.min(45, count * 7);
    return Math.round(clamp(simple, 0, 100));
  }

  const metrics = input?.metrics || {};

  const countScore = clamp(metrics.count / 8, 0, 1) * 28;
  const depthScore = clamp(metrics.avgChars / 110, 0, 1) * 24;
  const questionScore = clamp(metrics.questionRate / 0.35, 0, 1) * 14;
  const aiResponseScore = clamp(metrics.replyRate, 0, 1) * 12;
  const peerInteractionScore = clamp(metrics.peerReplyRate / 0.6, 0, 1) * 8;
  const keywordScore = clamp(metrics.keywordDiversity / 24, 0, 1) * 10;
  const spanScore = clamp(metrics.activeSpanMin / 35, 0, 1) * 4;

  const raw = countScore + depthScore + questionScore + aiResponseScore + peerInteractionScore + keywordScore + spanScore;
  return Math.round(clamp(raw, 0, 100));
}

function analyzeRoom(room) {
  const messages = (room.messages || []).filter((m) => m.type === 'text');
  const students = Array.from(room.participantRecords || new Map())
    .filter(([sid]) => sid !== room.teacherId)
    .map(([studentId, { name }]) => ({ studentId, name }))
    .sort(sortByStudentId);

  const allText = messages.map((m) => m.content || '');
  const allTimes = messages.map((m) => getMsgTime(m)).filter((t) => t != null).sort((a, b) => a - b);

  const scoreTable = students.map((s) => {
    const metrics = buildStudentMetrics(room, s.studentId);
    
    // 新评分系统：计算四项评分
    const messageCount = room.messageCounts?.get(s.studentId) || 0;
    
    // 1. 机器态度评分
    const machineAttitude = calculateMachineAttitudeScore(messageCount);
    
    // 2. 机器思维评分
    const studentMessages = messages.filter(m => 
      m.sender?.id === s.studentId && m.type === 'text'
    );
    const machineThinking = calculateRuleBasedThinkingScore(studentMessages, {
      studentName: s.name,
      roomCode: room.roomCode
    });
    
    // 3. 教师评分（兼容旧数据）
    let teacherAttitudeScore = 100;
    let teacherThinkingScore = 100;
    let teacherAttitudeEdited = false;
    let teacherThinkingEdited = false;
    
    const teacherScoreData = room.teacherScores?.get(s.studentId);
    if (teacherScoreData) {
      if (typeof teacherScoreData === 'number') {
        // 旧数据：单个数字，映射为attitude评分
        teacherAttitudeScore = teacherScoreData;
        teacherAttitudeEdited = true;
      } else if (typeof teacherScoreData === 'object') {
        // 新数据：包含attitude和thinking
        teacherAttitudeScore = teacherScoreData.attitude?.score || 100;
        teacherThinkingScore = teacherScoreData.thinking?.score || 100;
        teacherAttitudeEdited = teacherScoreData.attitude?.edited || false;
        teacherThinkingEdited = teacherScoreData.thinking?.edited || false;
      }
    }
    
    // 兼容性：计算旧的machineScore和teacherScore
    const machine = machineScore({ metrics, name: s.name, studentId: s.studentId });
    let teacher = 100; // 默认值
    
    if (teacherScoreData) {
      if (typeof teacherScoreData === 'number') {
        // 旧数据：单个数字
        teacher = teacherScoreData;
      } else if (typeof teacherScoreData === 'object') {
        // 新数据：包含attitude和thinking，使用attitude作为主要评分
        teacher = teacherScoreData.attitude?.score ?? 100;
      }
    }
    
    // 新的四项评分合成逻辑
    let finalMachineAttitudeScore = machineAttitude.score;
    let finalMachineThinkingScore = machineThinking.score;
    let finalTeacherAttitudeScore = teacherAttitudeScore;
    let finalTeacherThinkingScore = teacherThinkingScore;
    
    // 旧字段兼容：如果新四项评分缺失，使用旧数据
    if (finalMachineAttitudeScore === null || finalMachineAttitudeScore === undefined) {
      finalMachineAttitudeScore = typeof machine === 'number' && !isNaN(machine) ? machine : 0;
    }
    if (finalMachineThinkingScore === null || finalMachineThinkingScore === undefined) {
      finalMachineThinkingScore = 0; // 旧数据没有思维评分，默认为0
    }
    if (finalTeacherAttitudeScore === null || finalTeacherAttitudeScore === undefined) {
      finalTeacherAttitudeScore = typeof teacher === 'number' && !isNaN(teacher) ? teacher : 100;
    }
    if (finalTeacherThinkingScore === null || finalTeacherThinkingScore === undefined) {
      finalTeacherThinkingScore = finalTeacherAttitudeScore; // 如果缺失，使用态度评分
    }
    
    // 确保都是0-100的安全数字
    const safeMachineAttitude = typeof finalMachineAttitudeScore === 'number' && !isNaN(finalMachineAttitudeScore) ? Math.max(0, Math.min(100, finalMachineAttitudeScore)) : 0;
    const safeMachineThinking = typeof finalMachineThinkingScore === 'number' && !isNaN(finalMachineThinkingScore) ? Math.max(0, Math.min(100, finalMachineThinkingScore)) : 0;
    const safeTeacherAttitude = typeof finalTeacherAttitudeScore === 'number' && !isNaN(finalTeacherAttitudeScore) ? Math.max(0, Math.min(100, finalTeacherAttitudeScore)) : 100;
    const safeTeacherThinking = typeof finalTeacherThinkingScore === 'number' && !isNaN(finalTeacherThinkingScore) ? Math.max(0, Math.min(100, finalTeacherThinkingScore)) : 100;
    
    // 四项各占25%的最终成绩公式
    const final = Math.max(0, Math.min(100, Math.round(
      safeMachineAttitude * 0.25 +
      safeMachineThinking * 0.25 +
      safeTeacherAttitude * 0.25 +
      safeTeacherThinking * 0.25
    )));
    
        
    return {
      studentId: s.studentId,
      name: s.name,
      messageCount: metrics.count,
      
      // 新的四项评分
      machineAttitudeScore: machineAttitude.score,
      machineAttitudeReason: machineAttitude.reason,
      machineThinkingScore: machineThinking.score,
      machineThinkingSource: machineThinking.source,
      machineThinkingComment: machineThinking.comment,
      machineThinkingDimensions: machineThinking.dimensions,
      teacherAttitudeScore: teacherAttitudeScore,
      teacherAttitudeEdited: teacherAttitudeEdited,
      teacherThinkingScore: teacherThinkingScore,
      teacherThinkingEdited: teacherThinkingEdited,
      
      // 兼容旧字段
      machineScore: machine,
      teacherScore: Math.round(teacher),
      finalScore: final,
      
      // 完整评分结构
      scores: {
        machine: {
          attitude: machineAttitude,
          thinking: machineThinking
        },
        teacher: {
          attitude: {
            score: teacherAttitudeScore,
            edited: teacherAttitudeEdited,
            updatedAt: null
          },
          thinking: {
            score: teacherThinkingScore,
            edited: teacherThinkingEdited,
            updatedAt: null
          }
        }
      },
      
      scoreBreakdown: {
        avgChars: round(metrics.avgChars, 2),
        questionCount: metrics.questionCount,
        aiReplyCount: metrics.aiReplyCount,
        keywordDiversity: metrics.keywordDiversity,
      },
    };
  });

  const metricsByStudent = new Map();
  const participation = scoreTable.map((row) => {
    const metrics = buildStudentMetrics(room, row.studentId);
    metricsByStudent.set(row.studentId, metrics);
    return {
      studentId: row.studentId,
      name: row.name,
      messageCount: row.messageCount,
      totalChars: metrics.totalChars,
      avgCharsPerMsg: round(metrics.avgChars, 2) || 0,
      questionCount: metrics.questionCount,
      aiReplyCount: metrics.aiReplyCount,
    };
  });

  const questionByStudent = participation.map((p) => ({
    studentId: p.studentId,
    name: p.name,
    questionCount: p.questionCount,
    aiReplyCount: p.aiReplyCount,
    peerReplyCount: metricsByStudent.get(p.studentId)?.peerReplyCount || 0,
    qualityIndex: (() => {
      const m = metricsByStudent.get(p.studentId);
      if (!m || p.questionCount <= 0) return 0;
      const aiRate = m.aiReplyCount / p.questionCount;
      const peerRate = m.peerReplyCount / p.questionCount;
      const answeredRate = m.answeredWindowCount / p.questionCount;
      return round((aiRate * 0.5 + peerRate * 0.3 + answeredRate * 0.2) * 100, 1) || 0;
    })(),
  }));

  const intervalsMin = [];
  for (let i = 1; i < allTimes.length; i++) {
    intervalsMin.push((allTimes[i] - allTimes[i - 1]) / 60000);
  }

  const minuteDistribution = [];
  if (allTimes.length > 0) {
    const start = allTimes[0];
    const bucketMap = new Map();
    allTimes.forEach((t) => {
      const minute = Math.floor((t - start) / 60000);
      bucketMap.set(minute, (bucketMap.get(minute) || 0) + 1);
    });
    const maxMinute = Math.max(...bucketMap.keys());
    for (let m = 0; m <= maxMinute; m++) {
      minuteDistribution.push({ minute: m, count: bucketMap.get(m) || 0 });
    }
  }

  const peakMinute = minuteDistribution.reduce((best, current) => (current.count > best.count ? current : best), { minute: 0, count: 0 }).minute;

  const keywordFreq = new Map();
  allText.forEach((line) => {
    extractKeywords(line).forEach((w) => keywordFreq.set(w, (keywordFreq.get(w) || 0) + 1));
  });
  const keywords = Array.from(keywordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  const topKeywordSet = new Set(keywords.map((k) => k.word));
  const pairCounter = new Map();
  allText.forEach((line) => {
    const terms = Array.from(new Set(extractKeywords(line).filter((w) => topKeywordSet.has(w))));
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const pair = [terms[i], terms[j]].sort().join('|');
        pairCounter.set(pair, (pairCounter.get(pair) || 0) + 1);
      }
    }
  });
  // 除同条消息共线外，增加相邻两条消息窗口，减少“空共线”
  for (let i = 0; i < allText.length - 1; i++) {
    const mergedTerms = Array.from(new Set(
      [...extractKeywords(allText[i]), ...extractKeywords(allText[i + 1])].filter((w) => topKeywordSet.has(w))
    ));
    for (let a = 0; a < mergedTerms.length; a++) {
      for (let b = a + 1; b < mergedTerms.length; b++) {
        const pair = [mergedTerms[a], mergedTerms[b]].sort().join('|');
        pairCounter.set(pair, (pairCounter.get(pair) || 0) + 1);
      }
    }
  }

  const keywordCooccurrence = Array.from(pairCounter.entries())
    .map(([pair, count]) => {
      const [source, target] = pair.split('|');
      const base = Math.sqrt((keywordFreq.get(source) || 1) * (keywordFreq.get(target) || 1));
      return { source, target, count, strength: round(count / base, 3) || 0 };
    })
    .filter((e) => e.count >= 2)
    .sort((a, b) => (b.strength - a.strength) || (b.count - a.count))
    .slice(0, 20);

  const teacherScores = scoreTable.map((s) => s.teacherScore);
  const machineScores = scoreTable.map((s) => s.machineScore);
  const finalScores = scoreTable.map((s) => s.finalScore);
  const avgLengths = participation.map((p) => p.avgCharsPerMsg);

  const pearsonRaw = safePearson(teacherScores, machineScores);
  const pearsonCorrelation = round(pearsonRaw, 3);
  const spearmanCorrelation = round(safeSpearman(teacherScores, machineScores), 3);
  const cccCorrelation = round(safeConcordanceCorrelation(teacherScores, machineScores), 3);

  let regressionSlope = null;
  let regressionIntercept = null;
  let regressionR2 = null;
  if (avgLengths.length > 1 && finalScores.length > 1) {
    try {
      const line = ss.linearRegression(avgLengths.map((x, i) => [x, finalScores[i]]));
      regressionSlope = round(line.m, 4);
      regressionIntercept = round(line.b, 4);
      const fn = ss.linearRegressionLine(line);
      const observed = finalScores;
      const predicted = avgLengths.map(fn);
      const obsMean = ss.mean(observed);
      const ssTot = observed.reduce((sum, y) => sum + ((y - obsMean) ** 2), 0);
      const ssRes = observed.reduce((sum, y, i) => sum + ((y - predicted[i]) ** 2), 0);
      regressionR2 = ssTot === 0 ? null : round(1 - (ssRes / ssTot), 4);
    } catch (_) {
      regressionSlope = null;
      regressionIntercept = null;
      regressionR2 = null;
    }
  }

  const avgMachine = machineScores.length ? round(ss.mean(machineScores), 2) : 0;
  const avgTeacher = teacherScores.length ? round(ss.mean(teacherScores), 2) : 0;
  const scoreGapMAE = machineScores.length
    ? round(ss.mean(machineScores.map((m, i) => Math.abs(m - teacherScores[i]))), 2)
    : 0;
  const participationMean = participation.length ? round(ss.mean(participation.map((p) => p.messageCount)), 2) : 0;
  const participationStd = participation.length > 1 ? round(ss.sampleStandardDeviation(participation.map((p) => p.messageCount)), 2) : 0;
  const askRate = participation.length
    ? round(
      ss.mean(
        participation.map((p) => (p.messageCount > 0 ? p.questionCount / p.messageCount : 0))
      ) * 100,
      1
    )
    : 0;
  const totalQuestions = questionByStudent.reduce((sum, s) => sum + (s.questionCount || 0), 0);
  const aiResponded = questionByStudent.reduce((sum, s) => sum + (s.aiReplyCount || 0), 0);
  const peerResponded = questionByStudent.reduce((sum, s) => sum + (s.peerReplyCount || 0), 0);
  const aiResponseRate = totalQuestions > 0 ? (aiResponded / totalQuestions) * 100 : 0;
  const peerResponseRate = totalQuestions > 0 ? (peerResponded / totalQuestions) * 100 : 0;

  return {
    teacherName: room.teacherName || room.users?.get?.(room.teacherId)?.name || '未知教师',
    date: new Date().toISOString().slice(0, 10),
    roomCode: room.roomCode,
    scoreTable,
    participation,
    questionStats: {
      totalQuestions,
      aiResponded,
      peerResponded,
      byStudent: questionByStudent,
    },
    timeStats: {
      avgInterval: intervalsMin.length ? round(ss.mean(intervalsMin), 2) : 0,
      medianInterval: intervalsMin.length ? round(ss.median(intervalsMin), 2) : 0,
      peakMinute,
      intervals: intervalsMin.slice(0, 300),
    },
    timeDistributionMinutes: minuteDistribution,
    scoreComparison: {
      teacher: teacherScores,
      machine: machineScores,
      final: finalScores,
      pearsonCorrelation,
      spearmanCorrelation,
      cccCorrelation,
      pearsonText: pearsonCorrelation == null ? '无法计算（数据无变化）' : null,
      maeGap: scoreGapMAE,
      sampleSize: scoreTable.length,
    },
    keywords,
    keywordCooccurrence,
    regressionSlope,
    regressionIntercept,
    regressionR2,
    regressionText: regressionSlope == null ? '无法计算（数据不足或无变化）' : null,
    statistics: {
      avgMachine,
      avgTeacher,
      scoreGapMAE,
      participationMean,
      participationStd,
      askRate,
      aiResponseRate: round(aiResponseRate, 1),
      peerResponseRate: round(peerResponseRate, 1),
      finalMedian: finalScores.length ? round(ss.median(finalScores), 2) : 0,
      finalStd: finalScores.length > 1 ? round(ss.sampleStandardDeviation(finalScores), 2) : 0,
    },
  };
}

module.exports = { analyzeRoom, machineScore };
