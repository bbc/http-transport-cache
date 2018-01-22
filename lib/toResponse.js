'use strict';

module.exports = (cached) => {
  const res = cached.item;
  return {
    body: res.body,
    headers: res.headers,
    statusCode: res.statusCode,
    elapsedTime: res.elapsedTime,
    url: res.url,
    fromCache: true,
    ttl: cached.ttl,
    revalidate: cached.revalidate
  };
};
