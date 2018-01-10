'use strict';

const assert = require('chai').assert;
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const bluebird = require('bluebird');
const sinon = require('sinon');
const sandbox = sinon.sandbox.create();

const { getFromCache, storeInCache, events } = require('../lib/cache');

const SEGMENT = 'body';
const VERSION = require('../package').version;
const bodySegment = {
  segment: `http-transport:${VERSION}:body`,
  id: 'http://www.example.com/'
};

const ID = 'http://www.example.com/';

const cachedResponse = {
  body: 'http-transport',
  statusCode: 200,
  url: 'http://www.example.com/',
  elapsedTime: 40
};

function createCache() {
  const cache = new Catbox.Client(new Memory());
  bluebird.promisifyAll(cache);

  return cache;
}

describe('Cache', () => {
  afterEach(() => {
    sandbox.restore();
  });

  it('returns a cached value', () => {
    const cache = createCache();
    return cache
      .startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 600))
      .then(() => {
        return getFromCache(cache, SEGMENT, ID)
          .catch(assert.ifError)
          .then((cached) => {
            assert.deepEqual(cached.item, cachedResponse);
          });
      });
  });

  it('stores a value in the cache', () => {
    const cache = createCache();
    return cache
      .startAsync()
      .then(() => storeInCache(cache, SEGMENT, ID, { a: 1 }, 600))
      .then(() => {
        return getFromCache(cache, SEGMENT, ID)
          .catch(assert.ifError)
          .then((cached) => {
            assert.deepEqual(cached.item, { a: 1 });
          });
      });
  });

  it('returns an error', () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').yields(new Error('error'));

    return cache.startAsync().then(() => {
      return getFromCache(cache, SEGMENT, ID)
        .then(() => assert.fail())
        .catch((err) => {
          assert.equal(err.message, 'error');
        });
    });
  });

  it('times out a request', () => {
    const cache = createCache();
    let cacheLookupComplete = false;
    sandbox.stub(cache, 'get').callsFake(() => {
      setTimeout(() => {
        cacheLookupComplete = true;
      }, 100);
    });

    return cache.startAsync().then(() => {
      const timeout = 10;
      return getFromCache(cache, SEGMENT, ID, { timeout })
        .then(() => assert.fail())
        .catch((err) => {
          assert.isFalse(cacheLookupComplete);
          assert.equal(err.message, `Cache timed out after ${timeout}`);
        });
    });
  });

  it('returns a cache miss when "ignoreCacheErrors" is true', () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').yields(new Error('cache lookup failed!'));

    return cache.startAsync().then(() => {
      const ignoreCacheErrors = true;
      return getFromCache(cache, SEGMENT, ID, { ignoreCacheErrors })
        .catch(() => assert.fail())
        .then((cached) => {
          assert.isNull(cached);
        });
    });
  });

  describe('events', () => {
    it('emits a cache hit event', () => {
      const cache = createCache();

      let cacheHit = false;
      events.on('cache.hit', () => {
        cacheHit = true;
      });

      return cache
        .startAsync()
        .then(() => cache.setAsync(bodySegment, cachedResponse, 600))
        .then(() => {
          return getFromCache(cache, SEGMENT, ID)
            .catch(assert.ifError)
            .then(() => {
              assert.ok(cacheHit);
            });
        });
    });

    it('emits a cache miss event', () => {
      const cache = createCache();

      let cacheMiss = false;
      events.on('cache.miss', () => {
        cacheMiss = true;
      });

      return cache.startAsync().then(() => {
        return getFromCache(cache, SEGMENT, ID)
          .catch(assert.ifError)
          .then(() => {
            assert.ok(cacheMiss);
          });
      });
    });

    it('emits a timeout event', () => {
      const cache = createCache();
      sandbox.stub(cache, 'get').callsFake(() => {
        setTimeout(() => { }, 100);
      });

      let cacheTimeout = false;
      events.on('cache.timeout', () => {
        cacheTimeout = true;
      });

      return cache.startAsync().then(() => {
        return getFromCache(cache, SEGMENT, ID, { timeout: 50 })
          .then(assert.ifError)
          .catch(() => {
            assert.ok(cacheTimeout);
          });
      });
    });

    it('emits a cache error event', () => {
      const cache = createCache();
      sandbox.stub(cache, 'get').yields(new Error('error'));

      let cacheError = false;
      events.on('cache.error', () => {
        cacheError = true;
      });

      return cache.startAsync().then(() => {
        return getFromCache(cache, SEGMENT, ID)
          .then(() => assert.fail())
          .catch(() => {
            assert.ok(cacheError);
          });
      });
    });

    it('emits a cache error event when "ignoreCacheErrors" is true', () => {
      const cache = createCache();
      sandbox.stub(cache, 'get').yields(new Error('error'));

      let cacheError = false;
      events.on('cache.error', () => {
        cacheError = true;
      });

      return cache.startAsync().then(() => {
        return getFromCache(cache, SEGMENT, ID, { ignoreCacheErrors: true })
          .then(() => assert.fail())
          .catch(() => {
            assert.ok(cacheError);
          });
      });
    });
  });
});
