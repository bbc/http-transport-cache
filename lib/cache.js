'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const events = require('./events');

const VERSION = require('../package').version;

const TimeoutError = bluebird.TimeoutError;

function createCacheKey(segment, ctx, opts) {
  const versionedSegment = `http-transport:${VERSION}:${segment}`;
  const requiredIdPart = `${ctx.req.getMethod()}:${ctx.req.getUrl()}`;
  const varyOn = _.get(opts, 'varyOn');

  if (!varyOn) {
    return {
      segment: versionedSegment,
      id: requiredIdPart
    };
  }

  const headers = ctx.req.getHeaders();
  const optionalIdPart = varyOn.map((key) => {
    if (headers[key]) {
      return `${key}=${headers[key]}`;
    }
    return `${key}=`;
  });

  return {
    segment: versionedSegment,
    id: `${requiredIdPart}:${optionalIdPart.join(',')}`
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
  let pending = cache.set(createCacheKey(segment, ctx, opts), body, ttl);
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout);
  }

  try {
    const value = await pending;
    return value;
  } catch (err) {
    if (err instanceof TimeoutError) {
      events.emitCacheEvent('timeout', opts, ctx);
    } else {
      events.emitCacheEvent('error', opts, ctx);
    }
    return body;
  }
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
