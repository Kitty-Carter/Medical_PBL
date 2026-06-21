const { pblConfig } = require('./config');
const deepseekWeb = require('./providers/deepseek_web');

const registry = {
  longcat: {
    name: 'longcat',
    call: async () => {
      throw new Error('longcat provider should be handled by existing pipeline');
    },
  },
  deepseek_web: deepseekWeb,
};

function resolveProviderName({ roleType, stage, triggerReason }) {
  const policy = String(pblConfig.providerPolicy || 'longcat_only').toLowerCase();
  const role = roleType || 'teacher';
  const teacher = role === 'teacher';

  if (!pblConfig.webRelayEnabled) return 'longcat';

  if (policy === 'web_relay_only') return 'deepseek_web';
  if (policy === 'longcat_only') return 'longcat';
  if (policy === 'hybrid_prefer_web_relay') return teacher ? 'deepseek_web' : 'longcat';
  if (policy === 'hybrid_prefer_longcat') return 'longcat';
  if (policy === 'teacher_webrelay_students_longcat') return teacher ? 'deepseek_web' : 'longcat';
  if (policy === 'teacher_longcat_students_webrelay') return teacher ? 'longcat' : 'deepseek_web';

  return 'longcat';
}

function getProvider(name) {
  return registry[name] || registry.longcat;
}

module.exports = {
  resolveProviderName,
  getProvider,
  registry,
};
