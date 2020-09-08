'use strict';

const _ = require('lodash');
const EventEmitter = require('events');
const events = new EventEmitter();

function emitCacheEvent(event, opts, ctx, duration, err) {
  const name = opts && opts.name ? opts.name : null;
  const type = name ? `cache.${name}.${event}` : `cache.${event}`;

  if (_.get(opts, 'includeCacheStatusInCtx', false)) {
    if (!_.get(ctx, 'cacheStatus')) {
      ctx.cacheStatus = [];
    }

    ctx.cacheStatus.push(event);
  }

  ctx.cacheDuration = duration;
  events.emit(type, ctx, err);
}

module.exports = {
  emitter: events,
  emitCacheEvent
};
