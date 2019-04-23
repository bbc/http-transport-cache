'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const events = require('./events');

const VERSION = require('../package').version;

const TimeoutError = bluebird.TimeoutError;

function createCacheKey(segment, ctx, opts) {
  const versionedSegment = `http-transport:${VERSION}:${segment}`;
  const requiredIdPart = `${ctx.req.getMethod()}:${ctx.req.getUrl()}`;
  let id = requiredIdPart;
  const varyOn = _.get(opts, 'varyOn');

  if (varyOn) {
    const headers = ctx.req.getHeaders();
    const optionalIdPart = [];

    varyOn.forEach((key) => {
      if (headers[key]) {
        return optionalIdPart.push(`${key}=${headers[key]}`);
      }
      return optionalIdPart.push(`${key}=`);
    });

    id = `${requiredIdPart}:${optionalIdPart.join(',')}`;
  }

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

async function getFromCache(cache, segment, ctx, opts) {
  let pending = cache.get(createCacheKey(segment, ctx, opts));
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout);
  }

  try {
    return await pending;
  } catch (err) {
    if (err instanceof TimeoutError) {
      events.emitCacheEvent('timeout', opts, ctx);
    } else {
      events.emitCacheEvent('error', opts, ctx);
    }

    if (_.get(opts, 'ignoreCacheErrors', false)) {
      return Promise.resolve(null);
    }
    throw err;
  }
}

async function storeInCache(cache, segment, ctx, body, ttl, opts) {
  try {
    const value = await cache.set(createCacheKey(segment, ctx, opts), body, ttl);
    return value;
  } catch (error) {
    events.emitCacheEvent('error');
    return body;
  }
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
