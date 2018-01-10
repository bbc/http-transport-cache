'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const EventEmitter = require('events');

const VERSION = require('../package').version;

const events = new EventEmitter();
const TimeoutError = bluebird.TimeoutError;

function createCacheKey(segment, id) {
  const versionedSegment = `http-transport:${VERSION}:${segment}`;

  return {
    segment: versionedSegment,
    id
  };
}

function getFromCache(cache, segment, id, opts) {
  let pending = new Promise((resolve, reject) => {
    cache.get(createCacheKey(segment, id), (err, cached) => {
      if (err) {
        events.emit('cache.error');
        return reject(err);
      }

      if (!cached) {
        events.emit('cache.miss');
      } else {
        events.emit('cache.hit');
      }
      resolve(cached);
    });
  });

  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = bluebird
      .resolve(pending)
      .timeout(timeout, `Cache timed out after ${timeout}`);
  }

  return pending.catch((err) => {
    if (err instanceof TimeoutError) {
      events.emit('cache.timeout');
    }

    if (_.get(opts, 'ignoreCacheErrors', false)) {
      return Promise.resolve(null);
    }
    throw err;
  });
}

function storeInCache(cache, segment, id, body, ttl) {
  return new Promise((resolve) => {
    cache.set(createCacheKey(segment, id), body, ttl, () => resolve());
  });
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
