'use strict';

const _ = require('lodash');
const bluebird = require('bluebird');

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const createCacheId = require('./cache').createCacheId;
const toResponse = require('./toResponse');
const events = require('./events');

const MAX_AGE = 'max-age';
const STALE_WHILST_REVALIDATE = 'stale-while-revalidate';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

const refreshing = new Map();

function getMaxAge(res) {
  const cacheControl = parseCacheControl(res.headers[CACHE_CONTROL]);
  return cacheControl[MAX_AGE] * 1000;
}

function revalidate(cached, req, cache, opts) {
  const needsRevalidation = cached.item.revalidate && cached.item.revalidate < Date.now();
  if (needsRevalidation) {
    const refresh = _.get(opts, 'refresh', _.noop);
    const url = req.getUrl();

    if (!refreshing.has(url)) {
      refreshing.set(url, true);

      bluebird.resolve(refresh(url))
        .then((res) => {
          if (res.statusCode >= 500) {
            throw new Error(`Failed to refresh ${url}, got status ${res.statusCode}`);
          }

          storeInCache(cache, SEGMENT, req.getRequestKey(), res.toJSON(), getMaxAge(res));
        })
        .catch(() => { })
        .finally(() => {
          refreshing.delete(url);
        });
    }
  }
}

function getExpiry(ctx, cacheControl) {
  const revalidateTime = _.get(ctx, 'res.item.revalidate', 0);
  const revalidateTtl = revalidateTime ? (Date.now() - revalidateTime) : 0;
  const originalExpiry = revalidateTtl || ctx.res.ttl;

  return originalExpiry || cacheControl[MAX_AGE] * 1000;
}

function shouldRevalidate(opts, ctx) {
  const httpMethod = ctx.req.getMethod();
  return _.get(opts, 'staleWhileRevalidate', false) && httpMethod === 'GET';
}

module.exports = (cache, opts) => {
  return async (ctx, next) => {
    if (!cache.isReady()) {
      await cache.start();
    }

    const cached = await getFromCache(cache, SEGMENT, ctx.req.getRequestKey(), opts, ctx);
    if (cached) {
      if (shouldRevalidate(opts, ctx)) {
        revalidate(cached, ctx.req, cache, opts);
      }
      ctx.res = toResponse(cached);
      events.emitCacheEvent('hit', opts, ctx);
      return;
    }
    events.emitCacheEvent('miss', opts, ctx);

    await next();

    if (ctx.isStale || ctx.res.statusCode >= 500) return;

    const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

    if (cacheControl && cacheControl[MAX_AGE]) {
      let expiry = getExpiry(ctx, cacheControl);

      const item = ctx.res.fromCache ? ctx.res : ctx.res.toJSON();
      const swrTtl = (cacheControl[STALE_WHILST_REVALIDATE] || 0) * 1000;
      const id = createCacheId(ctx, opts);

      if (shouldRevalidate(opts, ctx) && !ctx.res.fromCache && swrTtl > 0) {
        item.revalidate = Date.now() + cacheControl[MAX_AGE] * 1000;
        expiry += swrTtl;
      }
      return storeInCache(cache, SEGMENT, id, item, expiry);
    }
  };
};
