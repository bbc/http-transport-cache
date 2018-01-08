'use strict';

const _ = require('lodash');
const EventEmitter = require('events');
const events = new EventEmitter();

const VERSION = require('../package').version;

function createCacheKey(segment, id) {
  const versionedSegment = `http-transport:${VERSION}:${segment}`;

  return {
    segment: versionedSegment,
    id
  };
}

function getFromCache(cache, segment, id, opts) {
  return new Promise((resolve, reject) => {
    cache.get(createCacheKey(segment, id), (err, cached) => {
      if (err) {
        events.emit('cache.error');
        if (!_.get(opts, 'ignoreCacheErrors', false)) {
          return reject(err);
        }
      }

      if (!cached) {
        events.emit('cache.miss');
      } else {
        events.emit('cache.hit');
      }
      resolve(cached);
    });
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
