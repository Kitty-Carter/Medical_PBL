/**
 * Web Relay Provider 插件封装
 * 通过 webRelayManager 提供统一的 request/cancel 能力
 */

const webRelayManager = require('./webRelayManager');

async function invoke(payload) {
  return webRelayManager.request(payload);
}

function cancel(requestId, reason = 'user_interrupted') {
  return webRelayManager.cancelRequest(requestId, reason);
}

module.exports = {
  invoke,
  cancel,
};
