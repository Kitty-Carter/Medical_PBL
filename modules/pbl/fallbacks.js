function pickFirstFact(state, recentMessages = []) {
  const facts = [];
  const v = state?.caseFacts?.vitals || {};
  if (v.BP) facts.push(`血压${v.BP}`);
  if (v.HR) facts.push(`心率${v.HR}`);
  if (v.SpO2) facts.push(`血氧${v.SpO2}`);
  if (v.T) facts.push(`体温${v.T}`);
  const labs = state?.caseFacts?.labs || [];
  const bleed = state?.caseFacts?.bleedingVolume;
  const lactate = state?.caseFacts?.lactate;
  if (bleed) facts.push(`出血量约${bleed}`);
  if (lactate) facts.push(`乳酸${lactate}`);
  if (labs.length) facts.push(labs[0]);
  if (state?.caseFacts?.chiefComplaint) facts.push(`主诉为${state.caseFacts.chiefComplaint}`);
  if (facts.length) return facts[0];
  const text = recentMessages.map((m) => m.content || '').join(' ');
  const m = text.match(/(血压[^，。；\s]{2,14}|Hb[^，。；\s]{1,12}|PLT[^，。；\s]{1,12}|PT[^，。；\s]{1,12}|APTT[^，。；\s]{1,12}|纤维蛋白原[^，。；\s]{1,12}|乳酸[^，。；\s]{1,12}|出血[^，。；\s]{1,16})/);
  return m?.[1] || '目前病情信息仍不完整';
}

function pickAction(state) {
  const stage = state?.stage || 'information_gathering';
  if (stage === 'information_gathering') return '先补全生命体征趋势和关键凝血指标，再决定诊断路径';
  if (stage === 'differential_diagnosis') return '优先排除高致死诊断，并同步列出支持与反证';
  if (stage === 'tests_and_workup') return '先完成最能改变处置路径的检查，再更新优先级';
  if (stage === 'treatment_plan') return '将治疗动作按“立即/1小时内/持续监测”分层执行';
  if (stage === 'risk_and_complications') return '先筛查并发症红旗，再决定是否升级监护强度';
  return '先做阶段小结，再明确下一轮验证目标';
}

function pickQuestion(roleType, state) {
  const unresolved = state?.unresolvedQuestions || [];
  if (unresolved.length) return unresolved[0].slice(0, 40);
  if (roleType === 'teacher') return '如果纤维蛋白原继续下降，你会优先纠正凝血还是先控源？';
  if (roleType === 'student_critic') return '若乳酸持续升高但血压暂时回升，是否还能排除休克进展？';
  return '若 PT/APTT 持续延长，你下一步会先补哪类制品并用什么指标复评？';
}

function buildRoleFallback({ turnTask, state, recentMessages = [], evidencePack }) {
  const fact = pickFirstFact(state, recentMessages);
  const action = pickAction(state);
  const question = pickQuestion(turnTask.roleType, state);
  const evidenceTip = evidencePack?.evidenceInsufficient
    ? '目前我只能基于常规临床路径判断，不作“最新指南”断言。'
    : '';

  if (turnTask.roleType === 'teacher') {
    return `我先回应你刚才的判断：${fact}提示风险还没被充分解释。当前缺口在于证据链尚未闭合，尤其是病因与凝血/灌注变化的对应关系。下一步建议：${action}。A/B分叉：若血压与乳酸不同步改善，你会优先按持续休克处理，还是先按单纯失血纠正？${evidenceTip}`.trim();
  }
  if (turnTask.roleType === 'student_critic') {
    return `我不同意“先下结论再补证据”的顺序。${fact}本身就提示当前推理可能低估了风险。替代做法是先用可证伪路径验证关键假设：${action}。追问：${question}${evidenceTip}`.trim();
  }
  return `我补一个容易漏掉的点：${fact}常与并发症风险同向上升，不能只看单一指标。建议先建立“红旗征象+复评时间点”清单，并把检查与处置绑定执行：${action}。追问：${question}${evidenceTip}`.trim();
}

module.exports = {
  buildRoleFallback,
};
