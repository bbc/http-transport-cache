'use strict';

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');

const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

module.exports = (cache) => {
  cache.start(() => {});

  return (ctx, next) => {
    return getFromCache(cache, SEGMENT, ctx.req.getUrl()).then((cached) => {
      if (cached) {
        const res = cached.item;
        ctx.res = toResponse(res);
        return;
      }

      return next().then(() => {
        if (ctx.isStale || ctx.res.statusCode >= 400) return;

        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);
        if (cacheControl[MAX_AGE]) {
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), cacheControl[MAX_AGE] * 1000);
        }
      });
    });
  };
};
