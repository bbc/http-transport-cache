'use strict';

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;

const noop = () => {};

const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'body';

module.exports = (cache) => {
  cache.start(noop);

  return (ctx, next) => {
    return getFromCache(cache, SEGMENT, ctx.req.getUrl())
      .then((cached) => {
        if (cached) {
          ctx.res = {
            body: cached.item
          };
          return;
        }

        return next().then(() => {
          const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);
          if (cacheControl[MAX_AGE]) {
            return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.body, cacheControl[MAX_AGE] * 1000);
          }
        });
      });
  };
};
