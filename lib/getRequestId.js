'use strict';

const { pickBy } = require('lodash');

module.exports = function getRequestId(req, doNotVary = []) {
  const cacheKey = req.getRequestKey();
  const headers = req.getHeaders();
  const headersToVary = pickBy(headers, (value, key) => {
    return !doNotVary.includes(key);
  });

  const headersString = JSON.stringify(headersToVary);
  return `${cacheKey}${headersString}`;
};
