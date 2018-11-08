'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const cacheKeyWithHeaders = require('./cacheKeyWithHeaders');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const events = require('./events');

const STALE_IF_ERROR = 'stale-if-error';
const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'stale';

class HttpError extends Error { }

function shouldUseKeyWithHeaders(opts) {
  return _.get(opts, 'useKeyWithHeaders', false);
}

module.exports = (cache, opts) => {
  return async (ctx, next) => {
    if (!cache.isReady()) {
      await cache.start();
    }

    let cached;
    try {
      await next();
      if (ctx.res.statusCode >= 500) throw new HttpError();
    } catch (err) {
      try {
        cached = await getFromCache(cache, SEGMENT, ctx.req.getRequestKey(), opts, ctx);
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
    if (cacheControl && cacheControl[STALE_IF_ERROR] && !ctx.res.fromCache) {
      const maxAgeMilliseconds = (cacheControl[MAX_AGE] || 0) * 1000;
      const staleIfErrorMilliseconds = cacheControl[STALE_IF_ERROR] * 1000;
      const ttl = maxAgeMilliseconds + staleIfErrorMilliseconds;

      const key = ctx.req.getRequestKey();
      const headers = ctx.req.getHeaders();
      const keyWithHeaders = cacheKeyWithHeaders(key, headers);
      const id = shouldUseKeyWithHeaders(opts) ? keyWithHeaders : key;

      console.log(id);

      return await storeInCache(cache, SEGMENT, id, ctx.res.toJSON(), ttl);
    }
  };
};
