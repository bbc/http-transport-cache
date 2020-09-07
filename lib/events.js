'use strict';

const _ = require('lodash');
const EventEmitter = require('events');
const events = new EventEmitter();

function emitCacheEvent(event, opts, ctx, err) {
  const name = opts && opts.name ? opts.name : null;
  const type = name ? `cache.${name}.${event}` : `cache.${event}`;

  if (_.get(opts, 'includeCacheStatusInCtx', true)) {
    if (!_.get(ctx, 'cacheAudit')) {
      ctx.cacheAudit = [];
    }

    ctx.cacheStatus = event;
    ctx.cacheAudit.push(event);
  }

  events.emit(type, ctx, err);
}

module.exports = {
  emitter: events,
  emitCacheEvent
};
