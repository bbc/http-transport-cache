'use strict';

const _ = require('lodash');
const assert = require('chai').assert;
const httpTransport = require('@bbc/http-transport');
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const nock = require('nock');
const bluebird = require('bluebird');
const sinon = require('sinon');

const sandbox = sinon.sandbox.create();
const cache = require('../');
const events = require('../').events;

const api = nock('http://www.example.com');

const VERSION = require('../package').version;

const defaultHeaders = {
  'cache-control': 'max-age=60'
};

const defaultResponse = {
  body: 'I am a string!',
  url: 'http://www.example.com/',
  statusCode: 200,
  elapsedTime: 40,
  headers: defaultHeaders
};

const bodySegment = {
  segment: `http-transport:${VERSION}:body`,
  id: 'http://www.example.com/'
};

nock.disableNetConnect();

function createCache() {
  const cache = new Catbox.Client(new Memory());
  bluebird.promisifyAll(cache);

  return cache;
}

function createCacheClient(catbox, opts) {
  return httpTransport.createClient()
    .use(cache.maxAge(catbox, opts));
}

function requestWithCache(catbox, opts) {
  return createCacheClient(catbox, opts)
    .get('http://www.example.com/')
    .asResponse();
}

describe('Max-Age', () => {
  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('sets the cache up ready for use', () => {
    const catbox = createCache();
    cache.maxAge(catbox);

    assert(catbox.isReady());
  });

  it('stores cached values for the max-age value', () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const expiry = Date.now() + 60000;

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => {
        const actualExpiry = cached.ttl + cached.stored;
        const differenceInExpires = actualExpiry - expiry;

        assert.deepEqual(cached.item.body, defaultResponse.body);
        assert(differenceInExpires < 1000);
      });
  });

  it('does not create cache entries for errors', () => {
    const catbox = createCache();

    api.get('/').reply(500, defaultResponse.body, defaultHeaders);

    return httpTransport
      .createClient()
      .use(cache.maxAge(catbox))
      .get('http://www.example.com/')
      .asResponse()
      .then(() => catbox.getAsync(bodySegment))
      .then((cached) => {
        assert.isNull(cached);
      });
  });

  it('creates cache entries for item fetcher from another cache with the correct ttl', async () => {
    const nearCache = createCache();
    const farCache = createCache();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const client = httpTransport.createClient();

    // populate the far-away cache first
    await client
      .use(cache.maxAge(farCache))
      .get('http://www.example.com/')
      .asResponse();

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Populate the near cache
    await client
      .use(cache.maxAge(nearCache))
      .use(cache.maxAge(farCache))
      .get('http://www.example.com/')
      .asResponse();

    const cachedItem = await nearCache.getAsync(bodySegment);

    assert.isBelow(cachedItem.ttl, 59950);
  });

  it('ignore cache lookup errors', () => {
    const catbox = createCache();
    sandbox.stub(catbox, 'get').yields(new Error('error'));

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    return httpTransport
      .createClient()
      .use(cache.maxAge(catbox, { ignoreCacheErrors: true }))
      .get('http://www.example.com/')
      .asBody()
      .catch(() => assert.fail())
      .then((body) => {
        assert.equal(body, defaultResponse.body);
      });
  });

  it('timeouts a cache lookup', () => {
    const catbox = createCache();
    let cacheLookupComplete = false;

    sandbox.stub(catbox, 'get').callsFake(() => {
      setTimeout(() => {
        cacheLookupComplete = true;
      }, 100);
    });
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const timeout = 10;
    return httpTransport
      .createClient()
      .use(cache.maxAge(catbox, { timeout }))
      .get('http://www.example.com/')
      .asBody()
      .then(() => assert.fail())
      .catch((err) => {
        assert.isFalse(cacheLookupComplete);
        assert.equal(err.message, `Cache timed out after ${timeout}`);
      });
  });

  it('ignores cache timeout error and requests from the system of record.', () => {
    const catbox = createCache();
    let cacheLookupComplete = false;

    sandbox.stub(catbox, 'get').callsFake(() => {
      setTimeout(() => {
        cacheLookupComplete = true;
      }, 100);
    });
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const timeout = 10;
    return httpTransport
      .createClient()
      .use(cache.maxAge(catbox, { timeout, ignoreCacheErrors: true }))
      .get('http://www.example.com/')
      .asBody()
      .catch(() => assert.fail(null, null, 'Failed on timeout'))
      .then((body) => {
        assert.isFalse(cacheLookupComplete);
        assert.equal(body, defaultResponse.body);
      });
  });

  describe('Stale while revalidate', () => {
    function nockAPI(maxage, swr) {
      api
        .get('/')
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });
    }

    function createResponse(maxage, swr) {
      const fakeResponse = _.clone(defaultResponse);
      fakeResponse.body = 'We ALL love jonty';

      return {
        headers: { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` },
        toJSON: () => {
          return fakeResponse;
        }
      };
    }

    it('increases the max-age by the stale-while-revalidate value', () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').yields();

      const maxage = 60;
      const swr = maxage * 2;
      nockAPI(maxage, swr);

      return requestWithCache(cache, { 'staleWhileRevalidate': true })
        .then(() => cache.getAsync(bodySegment))
        .then(() => {
          sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, (maxage + swr) * 1000);
        });
    });

    it('updates cache on successful refresh', async () => {
      const cache = createCache();

      const maxage = 1;
      const swr = maxage * 2;
      nockAPI(maxage, swr);

      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          return bluebird.resolve(createResponse(maxage, swr));
        }
      };

      await requestWithCache(cache, opts);

      return bluebird
        .delay((maxage * 1000))
        .then(() => {
          return requestWithCache(cache, opts)
            .then(() => bluebird.delay(50))
            .then(() => cache.getAsync(bodySegment))
            .then((cached) => {
              assert.equal(cached.item.body, 'We ALL love jonty');
            });
        });
    });

    it('sets correct TTL when storing refresh response', async () => {
      const cache = createCache();

      const maxAge = 1;
      const swr = maxAge * 2;
      const delay = 50;
      const tolerance = 50;

      nockAPI(maxAge, swr);

      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          return bluebird.resolve(createResponse(maxAge, swr));
        }
      };

      await requestWithCache(cache, opts);

      return bluebird
        .delay((maxAge * 1000))
        .then(() => {
          return requestWithCache(cache, opts)
            .then(() => bluebird.delay(delay))
            .then(() => cache.getAsync(bodySegment))
            .then((cached) => {
              const ttl = cached.ttl;
              assert(ttl < maxAge * 1000);
              assert(ttl > (maxAge * 1000) - delay - tolerance);
            });
        });
    });

    it('sets correct TTL when storing a cached response', async () => {
      const maxAge = 10;
      const swr = maxAge * 2;

      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          return bluebird.resolve(createResponse(maxAge, swr));
        }
      };

      const nearCache = createCache();
      const farCache = createCache();

      api.get('/').reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxAge},stale-while-revalidate=${swr}` });

      const client = httpTransport.createClient();

      // populate the far-away cache first
      await client
        .use(cache.maxAge(farCache, opts))
        .get('http://www.example.com/')
        .asResponse();

      await new Promise((resolve) => setTimeout(resolve, 101));

      // Populate the near cache
      await client
        .use(cache.maxAge(nearCache, opts))
        .use(cache.maxAge(farCache, opts))
        .get('http://www.example.com/')
        .asResponse();

      const cachedItem = await nearCache.getAsync(bodySegment);
      assert.isBelow(cachedItem.ttl, 29900);
    });

    it('does not use stale-while-revalidate when set to 0', () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').yields();

      const maxage = 1;
      const swr = 0;
      nockAPI(maxage, swr);

      return requestWithCache(cache, { 'staleWhileRevalidate': true })
        .then(() => cache.getAsync(bodySegment))
        .then(() => {
          sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, maxage * 1000);
        });
    });

    it('does not use stale-while-revalidate if disabled', () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').yields();

      const maxage = 1;
      const swr = 7200;
      nockAPI(maxage, swr);

      return requestWithCache(cache, { 'stale-while-revalidate': false })
        .then(() => cache.getAsync(bodySegment))
        .then(() => {
          sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, maxage * 1000);
        });
    });

    it('disallows multiple refreshes for the same request at a time', async () => {
      const cache = createCache();

      const maxage = 1;
      const swr = maxage * 2;
      api
        .get('/')
        .times(3)
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      let called = 0;
      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          called++;
          return bluebird.resolve(createResponse(maxage, swr));
        }
      };

      await requestWithCache(cache, opts);
      await bluebird.delay(maxage * 1000);

      const pending = [];
      pending.push(requestWithCache(cache, opts));
      pending.push(requestWithCache(cache, opts));

      await Promise.all(pending);

      assert.equal(called, 1);
    });

    it('ensures that entries are deleted on error', async () => {
      const cache = createCache();

      const maxage = 1;
      const swr = maxage * 2;
      api
        .get('/')
        .times(3)
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      const fakeResponse = _.clone(defaultResponse);
      fakeResponse.body = 'We ALL love jonty';

      let called = 0;
      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          called++;
          return bluebird.reject(new Error('BORKED!'));
        }
      };

      await requestWithCache(cache, opts);
      await bluebird.delay(maxage * 1000);
      await requestWithCache(cache, opts);
      await bluebird.delay(50);
      await requestWithCache(cache, opts);

      assert.equal(called, 2);
    });
  });

  describe('cache keys', () => {
    it('keys cache entries by url', () => {
      const cache = createCache();
      api.get('/some-cacheable-path').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      return createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path')
        .asResponse()
        .then(() =>
          cache.getAsync({
            segment: `http-transport:${VERSION}:body`,
            id: 'http://www.example.com/some-cacheable-path'
          })
        )
        .then((cached) => {
          const actualExpiry = cached.ttl + cached.stored;
          const differenceInExpires = actualExpiry - expiry;

          assert.deepEqual(cached.item.body, defaultResponse.body);
          assert(differenceInExpires < 1000);
        });
    });

    it('keys cache entries by url including query strings in request url', () => {
      const cache = createCache();
      api.get('/some-cacheable-path?d=ank').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      return createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path?d=ank')
        .asResponse()
        .then(() =>
          cache.getAsync({
            segment: `http-transport:${VERSION}:body`,
            id: 'http://www.example.com/some-cacheable-path?d=ank'
          })
        )
        .then((cached) => {
          const actualExpiry = cached.ttl + cached.stored;
          const differenceInExpires = actualExpiry - expiry;

          assert.deepEqual(cached.item.body, defaultResponse.body);
          assert(differenceInExpires < 1000);
        });
    });

    it('keys cache entries by url including query strings in query object', () => {
      const cache = createCache();
      api.get('/some-cacheable-path?d=ank').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      return createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path')
        .query('d', 'ank')
        .asResponse()
        .then(() =>
          cache.getAsync({
            segment: `http-transport:${VERSION}:body`,
            id: 'http://www.example.com/some-cacheable-path?d=ank'
          })
        )
        .then((cached) => {
          const actualExpiry = cached.ttl + cached.stored;
          const differenceInExpires = actualExpiry - expiry;

          assert.deepEqual(cached.item.body, defaultResponse.body);
          assert(differenceInExpires < 1000);
        });
    });
  });

  it('does not store if no cache-control', () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse);

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => assert(!cached));
  });

  it('does not store if max-age=0', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'max-age=0'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => assert(!cached));
  });

  it('returns a cached response when available', () => {
    const headers = {
      'cache-control': 'max-age=0'
    };

    const cachedResponse = {
      body: 'http-transport',
      headers,
      statusCode: 200,
      url: 'http://www.example.com/',
      elapsedTime: 40
    };

    const cache = createCache();
    api.get('/').reply(200, defaultResponse, {
      headers
    });

    return cache
      .startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 600))
      .then(() => requestWithCache(cache))
      .then((res) => {
        assert.equal(res.body, cachedResponse.body);
        assert.deepEqual(res.headers, cachedResponse.headers);
        assert.equal(res.statusCode, cachedResponse.statusCode);
        assert.equal(res.url, cachedResponse.url);
        assert.equal(res.elapsedTime, cachedResponse.elapsedTime);

        return cache.drop(bodySegment);
      });
  });

  describe('Events', () => {
    it('emits events with name when name option is present', () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheMiss = false;
      events.on('cache.ceych.miss', () => {
        cacheMiss = true;
      });

      const opts = {
        name: 'ceych'
      };

      return requestWithCache(cache, opts)
        .then(() => {
          assert.ok(cacheMiss);
        });
    });

    it('emits a cache miss event', () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheMiss = false;
      events.on('cache.miss', () => {
        cacheMiss = true;
      });

      return requestWithCache(cache)
        .then(() => {
          assert.ok(cacheMiss);
        });
    });

    it('emits a cache hit event', () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheHit = false;
      events.on('cache.hit', () => {
        cacheHit = true;
      });

      return requestWithCache(cache)
        .then(() => {
          return requestWithCache(cache)
            .then(() => {
              assert.ok(cacheHit);
            });
        });
    });
  });
});
