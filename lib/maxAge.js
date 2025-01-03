'use strict';

const _ = require('lodash');

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const isCachable = require('./isCachable');
const events = require('./events');
const directives = require('./directives');
const startCacheConnection = require('./cacheConnection').startCacheConnection;
const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

function getExpiry(ctx, cacheControl, defaultTTL) {
  const revalidateTime = _.get(ctx, 'res.item.revalidate', 0);
  const revalidateTtl = revalidateTime ? (Date.now() - revalidateTime) : 0;
  const originalExpiry = revalidateTtl || ctx.res.ttl;

  return originalExpiry || cacheControl[MAX_AGE] * 1000 || defaultTTL * 1000;
}

module.exports = (cache, opts) => {
  return async (ctx, next) => {
    if (!cache.isReady()) {
      try {
        const timeout = _.get(opts, 'connectionTimeout');
        await startCacheConnection({ cache, timeout });
      } catch (err) {
        events.emitCacheEvent('connection_error', opts, ctx, null, err);
        if (_.get(opts, 'ignoreCacheErrors', false)) return next();
        throw err;
      }
    }

    let cacheErrored;
    let cached;
    try {
      cached = await getFromCache(cache, SEGMENT, ctx, opts);
    } catch (error) {
      cacheErrored = true;
      if (_.get(opts, 'ignoreCacheErrors', false)) {
        cached = null;
      } else {
        throw error;
      }
    }

    if (cached) {
      ctx.res = toResponse(cached);
      events.emitCacheEvent('hit', opts, ctx);
      return;
    }
    events.emitCacheEvent('miss', opts, ctx);

    await next();

    if (ctx.isStale || ctx.res.statusCode >= 500) return;

    const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

    if (!cacheErrored && isCachable(cacheControl, directives.MAX_AGE, opts?.defaultTTL)) {
      const expiry = getExpiry(ctx, cacheControl, opts?.defaultTTL);

      const item = ctx.res.fromCache ? ctx.res : ctx.res.toJSON();
      storeInCache(cache, SEGMENT, ctx, item, expiry, opts);
      return item;
    }
  };
};
