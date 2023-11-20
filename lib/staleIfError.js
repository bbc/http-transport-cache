'use strict';

const _ = require('lodash');
const Levee = require('levee');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const isCachable = require('./isCachable');
const events = require('./events');
const directives = require('./directives');
const startCacheConnection = require('./cacheConnection').startCacheConnection;
const isCacheReady = require('./cacheConnection').isCacheReady;

const STALE_IF_ERROR = 'stale-if-error';
const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'stale';

class HttpError extends Error { }

module.exports = (cache, opts) => {
  const circuitBreakerOptions = _.get(opts, 'connectionCircuitBreakerOptions');
  const circuitBreaker = circuitBreakerOptions ? Levee.createBreaker(isCacheReady, circuitBreakerOptions) : null;
  return async (ctx, next) => {
    if (!cache.isReady()) {
      try {
        const timeout = _.get(opts, 'connectionTimeout');
        await startCacheConnection({ cache, timeout, circuitBreaker });
      } catch (err) {
        events.emitCacheEvent('connection_error', opts, ctx, null, err);
        if (_.get(opts, 'ignoreCacheErrors', false)) return next();
        throw err;
      }
    }

    let cached;
    try {
      await next();
      if (ctx.res.statusCode >= 500) throw new HttpError();
    } catch (err) {
      try {
        cached = await getFromCache(cache, SEGMENT, ctx, opts);
      } catch (cacheErr) {
        if (_.get(opts, 'ignoreCacheErrors', false)) throw err;
        throw cacheErr;
      }

      if (cached) {
        ctx.isStale = true;
        ctx.res = toResponse(cached);
        events.emitCacheEvent('stale', opts, ctx);
        return;
      }

      if (err instanceof HttpError) return;
      return Promise.reject(err);
    }

    const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

    if (isCachable(cacheControl, directives.STALE_IF_ERROR, opts?.defaultTTL) && !ctx.res.fromCache) {
      const maxAgeMilliseconds = (cacheControl[MAX_AGE] || opts?.defaultTTL || 0) * 1000;
      const staleIfErrorMilliseconds = (cacheControl[STALE_IF_ERROR] || 0) * 1000;
      const ttl = maxAgeMilliseconds + staleIfErrorMilliseconds;

      storeInCache(cache, SEGMENT, ctx, ctx.res.toJSON(), ttl, opts);
      return ctx.res.toJSON();
    }
  };
};
