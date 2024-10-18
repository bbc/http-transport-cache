'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');
const events = require('./events');
const { logger } = require('@bbc/http-transport');
const VERSION = require('../config').cache.version;

const TimeoutError = bluebird.TimeoutError;

function createCacheKey(segment, ctx, opts) {
  /** The `VERSION` should be manually incremented in the config if there are changes to the data */
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

function applyTimeout(pending, timeout, getOrSet, url, segment) {
  const timeoutMessage = `Cache ${getOrSet} timed out after ${timeout}ms - url: ${url} - segment: ${segment}`;
  return bluebird
    .resolve(pending)
    .timeout(timeout, timeoutMessage);
}

async function getFromCache(cache, segment, ctx, opts) {
  const cacheKeyStart = new Date();
  const key = createCacheKey(segment, ctx, opts);
  console.log(`Cache key creation: [${new Date() - cacheKeyStart}ms]`);

  const startTime = new Date();
  let pending = cache.get(key);
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout, 'get', ctx.req.getUrl(), segment);
  }

  try {
    const pendingStart = new Date();
    const value = await pending;
    console.log(`Pending: [${new Date() - pendingStart}ms]`);
    const duration = new Date() - startTime;
    events.emitCacheEvent('read_time', opts, ctx, duration);
    return value;
  } catch (err) {
    const duration = new Date() - startTime;
    if (err instanceof TimeoutError) {
      events.emitCacheEvent('timeout', opts, ctx, duration, err);
    } else {
      events.emitCacheEvent('error', opts, ctx, duration, err);
    }
    throw err;
  }
}

async function storeInCache(cache, segment, ctx, body, ttl, opts) {
  const cacheKeyStart = new Date();
  const key = createCacheKey(segment, ctx, opts);
  console.log(`Cache key creation: [${new Date() - cacheKeyStart}ms]`);

  const startTime = new Date();
  let pending = cache.set(key, body, ttl);
  const timeout = _.get(opts, 'timeout');
  if (timeout) {
    pending = applyTimeout(pending, timeout, 'set', ctx.req.getUrl(), segment);
  }

  try {
    const pendingStart = new Date();
    await pending;
    console.log(`Pending: [${new Date() - pendingStart}ms]`);
    const duration = new Date() - startTime;
    events.emitCacheEvent('write_time', opts, ctx, duration);
  } catch (err) {
    const duration = new Date() - startTime;
    if (err instanceof TimeoutError) {
      events.emitCacheEvent('timeout', opts, ctx, duration, err);
    } else {
      events.emitCacheEvent('error', opts, ctx, duration, err);
    }
  }
}

module.exports = {
  getFromCache,
  storeInCache,
  events
};
