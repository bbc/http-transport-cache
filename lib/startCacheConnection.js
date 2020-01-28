'use strict';

// const Levee = require('levee');
const bluebird = require('bluebird');
//
// const circuitBreakerOptions = {
//   maxFailures: 1,
//   resetTimeout: 300000
// };
//
// const circuitBreaker = Levee.createBreaker(isCacheReady, circuitBreakerOptions);

function applyTimeout(pending, timeout) {
  if (!timeout) return pending;

  return bluebird
    .resolve(pending)
    .timeout(timeout, `Starting cache timed out after ${timeout}`);
}

// function isCacheReady({cache, timeout}, callback) {
//   console.log('checking cache is ready!');
//   applyTimeout(cache.start(), timeout)
//     .then(() => {
//       console.log('success!');
//       callback();
//     })
//     .catch((err) => {
//       console.log('timeout!');
//       callback(err);
//     });
// }

async function startCacheConnection({cache, timeout, useConnectionCircuitBreaker}) {
  // console.log('starting cache connection', feedName);
  if (!useConnectionCircuitBreaker) return applyTimeout(cache.start(), timeout);
  //
  // return new Promise((resolve, reject) => {
  //   circuitBreaker.run({cache, timeout }, (err) => {
  //     if (err) console.log('error happened');
  //     if (err) return reject();
  //     resolve();
  //   });
  // });
}

module.exports = startCacheConnection;
