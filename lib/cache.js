'use strict';

function createCacheKey(segment, id) {
  const versionedSegment = `http-transport:1.0.0:${segment}`;

  return {
    segment: versionedSegment,
    id
  };
}

function getFromCache(cache, segment, id) {
  return new Promise((resolve) => {
    cache.get(
      createCacheKey(segment, id),
      (err, cached) => resolve(cached)
    );
  });
}

function storeInCache(cache, segment, id, body, ttl) {
  return new Promise((resolve) => {
    cache.set(
      createCacheKey(segment, id),
      body,
      ttl,
      () => resolve()
    );
  });
}

module.exports = {
  getFromCache,
  storeInCache
};
