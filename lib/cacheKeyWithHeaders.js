'use strict';

const { isEmpty } = require('lodash');

module.exports = function cacheKeyWithHeaders(key, headers = {}) {
  const headersString = !isEmpty(headers) ? JSON.stringify(headers) : '';
  return `${key}${headersString}`;
};
