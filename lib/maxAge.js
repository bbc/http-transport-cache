'use strict';

const _ = require('lodash');

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const isCachable = require('./isCachable');
const events = require('./events');
const directives = require('./directives');

const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

function getExpiry(ctx, cacheControl) {
  const revalidateTime = _.get(ctx, 'res.item.revalidate', 0);
  const revalidateTtl = revalidateTime ? (Date.now() - revalidateTime) : 0;
  const originalExpiry = revalidateTtl || ctx.res.ttl;

  return originalExpiry || cacheControl[MAX_AGE] * 1000;
}

module.exports = (cache, opts) => {
  return async (ctx, next) => {
    if (!cache.isReady()) {
      try {
        await cache.start();
      } catch (err) {
        if (_.get(opts, 'ignoreCacheErrors', false)) return next();
        throw err;
      }
    }

    const cached = await getFromCache(cache, SEGMENT, ctx, opts);
    if (cached) {
      ctx.res = toResponse(cached);
      events.emitCacheEvent('hit', opts, ctx);
      return;
    }
    events.emitCacheEvent('miss', opts, ctx);

    await next();

    if (ctx.isStale || ctx.res.statusCode >= 500) return;

    const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

    if (isCachable(cacheControl, directives.MAX_AGE)) {
      const expiry = getExpiry(ctx, cacheControl);

      const item = ctx.res.fromCache ? ctx.res : ctx.res.toJSON();
      return storeInCache(cache, SEGMENT, ctx, item, expiry, opts);
    }
  };
};
