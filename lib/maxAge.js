'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');

const SEGMENT = 'body';

function getStaleWhileRevalidate(res) {
  let swr = 0;
  const cacheControl = getCacheControl(res);
  if (cacheControl) {
    swr = (cacheControl['stale-while-revalidate'] || 0) * 1000;
  }
  return swr;
}

function getCacheControl(res) {
  const cacheControl = res.headers['cache-control'];
  if (!cacheControl) return;
  return parseCacheControl(cacheControl);
}

function getMaxAge(res) {
  let maxAge = -1;
  const cacheControl = getCacheControl(res);
  if (cacheControl) {
    maxAge = (cacheControl['max-age'] || 0) * 1000;
  }
  return maxAge;
}

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
        ctx.res = toResponse(cached.item);
        return;
      }

      return next().then(() => {
        if (ctx.isStale || ctx.res.statusCode >= 400) return;

        let maxAge = getMaxAge(ctx.res);
        if (maxAge && !ctx.res.fromCache) {
          if (staleWhilstRevalidate) {
            ctx.res.revalidate = new Date().getTime() + maxAge;
            maxAge = maxAge + getStaleWhileRevalidate(ctx.res);
          }
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), maxAge);
        }
      });
    });
  };
};
