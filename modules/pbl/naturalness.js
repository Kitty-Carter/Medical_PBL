const cooldownStore = new Map();

const VARIANTS = {
  teacher_open: [
    '先把争议点钉住：',
    '我先回应你们刚才最关键的判断：',
    '这里我想先把优先级拉回主线：',
    '你们说得有价值，但现在先看核心矛盾：',
    '我们先不急着定论，先看最危险的问题：',
    '这一轮我先做个收束：',
    '先肯定一点，再纠正一点：',
    '如果按现在路径继续，最大的风险在于：',
    '先把证据链补齐再下结论：',
    '我先给出带教视角的判断：',
  ],
  critic_open: [
    '我同意你一半，但关键漏洞在这：',
    '这个结论下得太快了，问题在于：',
    '我不同意当前收敛方式，原因是：',
    '你这条链条有断点：',
    '这一步推理风险偏高：',
    '我先挑一个最可能误导决策的点：',
    '从概率和危险度看，这里不稳：',
    '这个判断要先被证伪：',
    '我保留意见，核心反证是：',
    '如果按你说的走，可能漏掉高危：',
  ],
  evidence_open: [
    '我补一条证据链上的缺口：',
    '我更担心被忽略的红旗是：',
    '从可执行性看，先补这个环节：',
    '你们的方向对，但缺一个关键监测点：',
    '我补一个临床上最容易漏的并发症线索：',
    '这里要把检查和处置绑定：',
    '证据层面我建议先补这一步：',
    '当前信息下，我会优先追这条线：',
    '这个病例不能只看单点指标：',
    '我补一个能直接改变路径的数据点：',
  ],
  branch: [
    '如果A成立，你会先走哪条处置路径；如果B成立，你会先停哪一步？',
    'A和B两种结果对应的优先级会怎么改？',
    '若指标继续恶化与若快速回升，两条路径你分别怎么定？',
    '如果检查结果与当前假设相反，你最先改哪一步？',
    'A/B两种分支下，哪个动作必须先做？',
    '若A出现你先升级什么；若B出现你先撤掉什么？',
    'A支持原判断，B反对原判断，你会如何重排鉴别？',
    '在A与B两种证据面前，你的风险排序会怎么变？',
    '若A成立，是否需要ICU路径；若B成立，是否可病房观察？',
    'A/B分叉后，哪项复评指标决定下一次转向？',
  ],
  summary_close: [
    '先把这轮结论收一下：',
    '我们当前一致的是，',
    '这轮先到这里，关键闭环是，',
    '我做一个阶段性总结：',
    '收束一下：',
  ],
};

function getBucket(sessionId) {
  if (!cooldownStore.has(sessionId)) cooldownStore.set(sessionId, {});
  return cooldownStore.get(sessionId);
}

function pickWithCooldown(sessionId, poolName) {
  const pool = VARIANTS[poolName] || [];
  if (!pool.length) return '';
  const bucket = getBucket(sessionId);
  const recent = bucket[poolName] || [];
  const cand = pool.filter((x) => !recent.includes(x));
  const pick = (cand.length ? cand : pool)[Math.floor(Math.random() * (cand.length ? cand.length : pool.length))];
  bucket[poolName] = [pick, ...recent].slice(0, 3);
  return pick;
}

function lexicalDedupe(text, avoidList = []) {
  let out = String(text || '');
  avoidList.forEach((a) => {
    if (!a) return;
    const re = new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, '');
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  pickWithCooldown,
  lexicalDedupe,
};
