'use strict';

const bluebird = require('bluebird');

function applyTimeoutIfNeeded(pending, timeout) {
  if (!timeout) return pending;

  return bluebird
    .resolve(pending)
    .timeout(timeout, `Starting cache timed out after ${timeout}`);
}

function isCacheReady({ cache, timeout }, callback) {
  applyTimeoutIfNeeded(cache.start(), timeout)
    .then(() => callback())
    .catch(callback);
}

async function startCacheConnection({cache, timeout, circuitBreaker }) {
  if (!circuitBreaker) return applyTimeoutIfNeeded(cache.start(), timeout);

  return new Promise((resolve, reject) => {
    circuitBreaker.run({cache, timeout }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

module.exports = {
  startCacheConnection,
  isCacheReady
};
