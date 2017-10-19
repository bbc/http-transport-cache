'use strict';

const maxAge = require('./lib/maxAge');
const staleIfError = require('./lib/staleIfError');
const events = require('./lib/cache').events;

module.exports = {
  maxAge,
  staleIfError,
  events
};
