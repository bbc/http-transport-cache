'use strict';

const wreck = require('@hapi/wreck');

module.exports = function parseCacheControl(cacheControlHeader) {
  if (!cacheControlHeader) {
    return {};
  }

  return wreck.parseCacheControl(cacheControlHeader);
};
