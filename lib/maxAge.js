'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');

const MAX_AGE = 'max-age';
const STALE_WHILST_REVALIDATE = 'stale-while-revalidate';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

function revalidate(cached, url, opts) {
  if (cached.item.revalidate && cached.item.revalidate < new Date().getTime()) {
    const fresh = _.get(opts.refresh, _.noop);
    fresh(url);
  }
}

module.exports = (cache, opts) => {
  cache.start(() => { });

  const staleWhilstRevalidate = _.get(opts, 'stale-whilst-revalidate', false);

  return (ctx, next) => {
    return getFromCache(cache, SEGMENT, ctx.req.getUrl(), opts).then((cached) => {
      if (cached) {
        if (staleWhilstRevalidate) {
          revalidate(cached, ctx.req.getUrl(), opts);
        }
        const res = cached.item;
        ctx.res = toResponse(res);
        return;
      }

      return next().then(() => {
        if (ctx.isStale || ctx.res.statusCode >= 400) return;

        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);
        let maxAge = cacheControl[MAX_AGE] * 1000;
        const swr = (cacheControl[STALE_WHILST_REVALIDATE] || 0) * 1000;

        if (maxAge && !ctx.res.fromCache) {
          if (staleWhilstRevalidate && swr > 0) {
            ctx.res.revalidate = new Date().getTime() + maxAge;
            maxAge = maxAge + swr;
          }
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), maxAge);
        }
      });
    });
  };
};
