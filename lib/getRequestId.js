'use strict';

module.exports = function getRequestId(req, doNotVary = []) {
  const cacheKey = req.getRequestKey();
  const headers = req.getHeaders();
  const headersString = JSON.stringify(headers);

  return `${cacheKey}${headersString}`;
};
