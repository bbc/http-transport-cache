'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const events = require('./events');

const VERSION = require('../package').version;

const TimeoutError = bluebird.TimeoutError;

function createCacheKey(segment, id) {
  const versionedSegment = `http-transport:${VERSION}:${segment}`;
  return {
    segment: versionedSegment,
    id
  };
}

function applyTimeout(pending, timeout) {
  return bluebird
    .resolve(pending)
    .timeout(timeout, `Cache timed out after ${timeout}`);
}

async function getFromCache(cache, segment, id, opts) {
  let pending = cache.get(createCacheKey(segment, id));

  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout);
  }

  try {
    return await pending;
  } catch (err) {
    if (err instanceof TimeoutError) {
      events.emitCacheEvent('timeout', opts);
    } else {
      events.emitCacheEvent('error', opts);
    }

    if (_.get(opts, 'ignoreCacheErrors', false)) {
      return Promise.resolve(null);
    }
    throw err;
  }
}

function storeInCache(cache, segment, id, body, ttl) {
  return cache.set(createCacheKey(segment, id), body, ttl);
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
