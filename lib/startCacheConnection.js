'use strict';

const bluebird = require('bluebird');

function applyTimeout(pending, timeout) {
  if (!timeout) return pending;

  return bluebird
    .resolve(pending)
    .timeout(timeout, `Starting cache timed out after ${timeout}`);
}

async function startCacheConnection({cache, timeout}) {
  return applyTimeout(cache.start(), timeout);
}

module.exports = startCacheConnection;
