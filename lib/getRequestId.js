'use strict';

const { pickBy } = require('lodash');

module.exports = function getRequestId(req, doNotVary = []) {
  const cacheKey = req.getRequestKey();
  const headers = req.getHeaders();
  const lowerCaseDoNotVary = doNotVary.map((vary) => vary.toLowerCase());
  const headersToVary = pickBy(headers, (value, key) => {
    const lowerCaseKey = key.toLowerCase();
    return !lowerCaseDoNotVary.includes(lowerCaseKey);
  });

  const headersString = JSON.stringify(headersToVary);
  return `${cacheKey}${headersString}`;
};
