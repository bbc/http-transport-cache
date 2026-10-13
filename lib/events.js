const EventEmitter = require('node:events');
const events = new EventEmitter();

function emitCacheEvent(event, opts, ctx, duration, err) {
  const name = opts?.name ? opts.name : null;
  const type = name ? `cache.${name}.${event}` : `cache.${event}`;

  if (opts?.includeCacheStatusInCtx ?? false) {
    if (!ctx.cacheStatus) {
      ctx.cacheStatus = [];
    }

    ctx.cacheStatus.push(event);
  }

  ctx.cacheDuration = duration;
  events.emit(type, ctx, err);
}

module.exports = {
  emitter: events,
  emitCacheEvent,
};
