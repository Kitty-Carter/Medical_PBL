function normalizeRelayError(err) {
  const msg = String(err?.message || err || '');
  if (/timeout/i.test(msg)) return 'timeout';
  if (/aborted/i.test(msg)) return 'aborted';
  if (/input not found/i.test(msg)) return 'selector_input_missing';
  if (/Executable doesn't exist/i.test(msg)) return 'browser_missing';
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'network_dns_failed';
  return 'relay_failed';
}

function shouldFallbackToLongcat(relayResult) {
  return !relayResult || !relayResult.relaySucceeded || !String(relayResult.content || '').trim();
}

module.exports = {
  normalizeRelayError,
  shouldFallbackToLongcat,
};
