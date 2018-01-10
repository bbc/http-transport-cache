'use strict';

module.exports = (res) => {
  return {
    body: res.body,
    headers: res.headers,
    statusCode: res.statusCode,
    elapsedTime: res.elapsedTime,
    url: res.url,
    fromCache: true
  };
};
