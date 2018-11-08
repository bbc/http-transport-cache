'use strict';

const { pickBy, isEmpty } = require('lodash');

module.exports = function cacheKeyWithHeaders(key, headers = {}, doNotVary = []) {
  const lowerCaseDoNotVary = doNotVary.map((vary) => vary.toLowerCase());

  const headersToVary = pickBy(headers, (value, key) => {
    const lowerCaseKey = key.toLowerCase();
    return !lowerCaseDoNotVary.includes(lowerCaseKey);
  });

  const headersString = !isEmpty(headersToVary) ?
    JSON.stringify(headersToVary) :
    '';

  return `${key}${headersString}`;
};
