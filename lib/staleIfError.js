'use strict';

const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const events = require('./cache').events;

const STALE_IF_ERROR = 'stale-if-error';
const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'stale';

class HttpError extends Error {}

module.exports = (cache) => {
  cache.start(() => {});

  return (ctx, next) => {
    return next()
      .then(() => {
        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

        if (ctx.res.statusCode >= 400) {
          throw new HttpError();
        }

        if (cacheControl[STALE_IF_ERROR]) {
          const maxAgeMilliseconds = (cacheControl[MAX_AGE] || 0) * 1000;
          const staleIfErrorMilliseconds = cacheControl[STALE_IF_ERROR] * 1000;
          const ttl = maxAgeMilliseconds + staleIfErrorMilliseconds;
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), ttl);
        }
      })
      .catch((err) => {
        return getFromCache(cache, SEGMENT, ctx.req.getUrl()).then((cached) => {
          if (cached) {
            const res = cached.item;

            ctx.res = {
              body: res.body,
              headers: res.headers,
              statusCode: res.statusCode,
              elapsedTime: res.elapsedTime,
              url: res.url
            };

            events.emit('cache.stale');
            ctx.isStale = true;

            return;
          }

          if (err instanceof HttpError) return;
          return Promise.reject(err);
        });
      });
  };
};
