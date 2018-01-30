'use strict';

const maxAge = require('./lib/maxAge');
const staleIfError = require('./lib/staleIfError');
const events = require('./lib/events').emitter;

module.exports = {
  maxAge,
  staleIfError,
  events
};
