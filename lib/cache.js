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
  const startTime = new Date();
  let pending = cache.get(createCacheKey(segment, ctx, opts));
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout);
  }

  try {
    const value = await pending;
    const duration = new Date() - startTime;
    events.emitCacheEvent('read_time', opts, duration);
    return value;
  } catch (err) {
    if (err instanceof TimeoutError) {
      if (_.get(opts, 'includeCacheStatusInCtx', false)) {
        ctx.res.cacheStatus = 'timeout';
      }
      events.emitCacheEvent('timeout', opts, ctx, err);
    } else {
      if (_.get(opts, 'includeCacheStatusInCtx', false)) {
        ctx.res.cacheStatus = 'error';
      }
      events.emitCacheEvent('error', opts, ctx, err);
    }
    throw err;
  }
}

async function storeInCache(cache, segment, ctx, body, ttl, opts) {
  const startTime = new Date();
  let pending = cache.set(createCacheKey(segment, ctx, opts), body, ttl);
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout);
  }

  try {
    await pending;
    const duration = new Date() - startTime;
    events.emitCacheEvent('write_time', opts, duration);
  } catch (err) {
    if (err instanceof TimeoutError) {
      if (_.get(opts, 'includeCacheStatusInCtx', false)) {
        ctx.res.cacheStatus = 'timeout';
      }
      events.emitCacheEvent('timeout', opts, ctx, err);
    } else {
      if (_.get(opts, 'includeCacheStatusInCtx', false)) {
        ctx.res.cacheStatus = 'error';
      }
      events.emitCacheEvent('error', opts, ctx, err);
    }
  }
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
