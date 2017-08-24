'use strict';

const wreck = require('wreck');

module.exports = function parseCacheControl(cacheControlHeader) {
  if (!cacheControlHeader) {
    return {};
  }

  return wreck.parseCacheControl(cacheControlHeader);
};