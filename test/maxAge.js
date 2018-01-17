'use strict';

const assert = require('chai').assert;
const httpTransport = require('@bbc/http-transport');
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const nock = require('nock');
const bluebird = require('bluebird');
const sinon = require('sinon');

const sandbox = sinon.sandbox.create();
const cache = require('../');

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

  it('does not create cache entries for items fetched from another cache', async () => {
    const nearCache = createCache();
    const farCache = createCache();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const client = httpTransport.createClient();

    // populate the far-away cache first
    await client
      .use(cache.maxAge(farCache))
      .get('http://www.example.com/')
      .asResponse();

    // response will originate from the far-away cache
    await client
      .use(cache.maxAge(nearCache))
      .use(cache.maxAge(farCache))
      .get('http://www.example.com/')
      .asResponse();

    const cachedItem = await nearCache.getAsync(bodySegment);
    assert.isNull(cachedItem);
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
    it('increases the max-age by the stale-while-revalidate value', () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').yields();

      const maxage = 60;
      const swr = maxage * 2;
      api
        .get('/')
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      return requestWithCache(cache, { 'stale-while-revalidate': true })
        .then(() => cache.getAsync(bodySegment))
        .then(() => {
          sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, (maxage + swr) * 1000);
        });
    });

    it.only('refreshes cache in the background', async () => {
      const cache = createCache();

      const maxage = 1;
      const swr = maxage * 2;
      api
        .get('/')
        .times(2)
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      const fn = sinon.spy();
      const opts = {
        'stale-while-revalidate': true,
        refresh: async () => {
          fn();
        }
      };

      // populate cache
      await requestWithCache(cache, opts);

      return bluebird
        .delay((maxage * 1000) + 20) // ensure previous cache entry has exired (based on original max-age value. Should be stale.)
        .then(() => {
          return requestWithCache(cache, opts)
            .then((res) => {
              sinon.assert.callCount(fn, 1);
              assert.equal(res.body, defaultResponse.body);
            });
        });
    });

    it.skip('serves a stale response when the "max-age" has expired', async () => {
      const cache = createCache();

      const maxage = 1;
      const swr = maxage * 2;
      api
        .get('/')
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      const fn = sinon.spy();
      const opts = {
        'stale-while-revalidate': true,
        refresh: () => {
          fn();
        }
      };

      // populate cache
      await requestWithCache(cache, opts);

      return bluebird
        .delay((maxage * 1000) + 20) // ensure previous cache entry has exired (based on original max-age value. Should be stale.)
        .then(() => {
          return requestWithCache(cache, opts)
            .then((res) => {
              sinon.assert.callCount(fn, 1);
              assert.equal(res.body, defaultResponse.body);
            });
        });
    });

    it('does not use stale-while-revalidate is set to 0');
    it('does not use stale-while-revalidate if disabled');
    it('disallows multiple refreshes for the same request at a time');
    it('returns a cache miss if the stale period has expired and the refresh has not completed');
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
});
