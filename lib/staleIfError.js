'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const events = require('./events');

const STALE_IF_ERROR = 'stale-if-error';
const MAX_AGE = 'max-age';
const CACHE_CONTROL = 'cache-control';
const SEGMENT = 'stale';

class HttpError extends Error { }

module.exports = (cache, opts) => {
  cache.start(() => { });

  return (ctx, next) => {
    return next()
      .then(() => {
        const cacheControl = parseCacheControl(ctx.res.headers[CACHE_CONTROL]);

        if (ctx.res.statusCode >= 400) {
          throw new HttpError();
        }

        if (cacheControl[STALE_IF_ERROR] && !ctx.res.fromCache) {
          const maxAgeMilliseconds = (cacheControl[MAX_AGE] || 0) * 1000;
          const staleIfErrorMilliseconds = cacheControl[STALE_IF_ERROR] * 1000;
          const ttl = maxAgeMilliseconds + staleIfErrorMilliseconds;
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), ttl);
        }
      })
      .catch((err) => {
        return getFromCache(cache, SEGMENT, ctx.req.getUrl(), opts)
          .catch((cacheErr) => {
            if (_.get(opts, 'ignoreCacheErrors', false)) throw err;
            throw cacheErr;
          })
          .then((cached) => {
            if (cached) {
              ctx.isStale = true;
              ctx.res = toResponse(cached);
              events.emitCacheEvent('stale', opts);
              return;
            }

            if (err instanceof HttpError) return;
            return Promise.reject(err);
          });
      });
  };
};
