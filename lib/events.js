'use strict';

const EventEmitter = require('events');
const events = new EventEmitter();

function emitCacheEvent(event, opts, ctx) {
  const name = opts && opts.name ? opts.name : null;
  const type = name ? `cache.${name}.${event}` : `cache.${event}`;
  events.emit(type, ctx);
}

module.exports = {
  emitter: events,
  emitCacheEvent
};
