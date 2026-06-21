const { deepSeekWebProvider } = require('./DeepSeekWebProvider');

module.exports = {
  providerName: 'deepseek_web',
  provider: deepSeekWebProvider,
  call: (payload) => deepSeekWebProvider.call(payload),
  evaluateDispatch: (ctx) => deepSeekWebProvider.evaluateDispatch(ctx),
  health: () => deepSeekWebProvider.health(),
  openSession: (input) => deepSeekWebProvider.openSession(input),
  testSend: (input) => deepSeekWebProvider.testSend(input),
  resetSession: (input) => deepSeekWebProvider.resetSession(input),
  cancelRoom: (roomCode, reason) => deepSeekWebProvider.cancelRoom(roomCode, reason),
  metrics: () => require('./metrics/relayMetrics').getMetrics(),
};
