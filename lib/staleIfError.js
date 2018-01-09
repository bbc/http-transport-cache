'use strict';

const _ = require('lodash');
const parseCacheControl = require('./parseCacheControl');
const getFromCache = require('./cache').getFromCache;
const storeInCache = require('./cache').storeInCache;
const toResponse = require('./toResponse');
const events = require('./cache').events;

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

        if (cacheControl[STALE_IF_ERROR]) {
          const maxAgeMilliseconds = (cacheControl[MAX_AGE] || 0) * 1000;
          const staleIfErrorMilliseconds = cacheControl[STALE_IF_ERROR] * 1000;
          const ttl = maxAgeMilliseconds + staleIfErrorMilliseconds;
          return storeInCache(cache, SEGMENT, ctx.req.getUrl(), ctx.res.toJSON(), ttl);
        }
      })
      .catch((err) => {
        return getFromCache(cache, SEGMENT, ctx.req.getUrl())
          .catch((cacheErr) => {
            if (_.get(opts, 'ignoreCacheErrors', false)) throw err;
            throw cacheErr;
          })
          .then((cached) => {
            if (cached) {
              const res = cached.item;
              ctx.isStale = true;
              ctx.res = toResponse(res);
              events.emit('cache.stale');
              return;
            }

            if (err instanceof HttpError) return;
            return Promise.reject(err);
          });
      });
  };
};
