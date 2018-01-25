'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const EventEmitter = require('events');

const VERSION = require('../package').version;

const events = new EventEmitter();
const TimeoutError = bluebird.TimeoutError;

function emitEvent(event, name) {
  const type = name ? `cache.${name}.${event}` : `cache.${event}`;
  events.emit(type);
}

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
        emitEvent('error', cache.name);
        return reject(err);
      }

      if (!cached) {
        emitEvent('miss', cache.name);
      } else {
        emitEvent('hit', cache.name);
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
      emitEvent('timeout', cache.name);
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
