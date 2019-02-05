'use strict';

const _ = require('lodash');

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const events = require('./events');

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
      await cache.start();
    }

    const cached = await getFromCache(cache, SEGMENT, ctx.req.getRequestKey(), opts, ctx);
    if (cached) {
      ctx.res = toResponse(cached);
      events.emitCacheEvent('hit', opts, ctx);
      return;
    }
    events.emitCacheEvent('miss', opts, ctx);

    await next();

    if (ctx.isStale || ctx.res.statusCode >= 500) return;

    const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

    if (cacheControl && cacheControl[MAX_AGE]) {
      const expiry = getExpiry(ctx, cacheControl);

      const item = ctx.res.fromCache ? ctx.res : ctx.res.toJSON();
      return storeInCache(cache, SEGMENT, ctx.req.getRequestKey(), item, expiry);
    }
  };
};
