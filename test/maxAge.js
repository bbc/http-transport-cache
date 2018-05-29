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
  id: 'GET:http://www.example.com/'
};

nock.disableNetConnect();

function createCache() {
  return new Catbox.Client(new Memory());
}

function createCacheClient(catbox, opts) {
  return httpTransport.createClient()
    .use(cache.maxAge(catbox, opts));
}

async function requestWithCache(catbox, opts) {
  return createCacheClient(catbox, opts)
    .get('http://www.example.com/')
    .asResponse();
}

describe('Max-Age', () => {
  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('stores cached values for the max-age value', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const expiry = Date.now() + 60000;

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    const actualExpiry = cached.ttl + cached.stored;
    const differenceInExpires = actualExpiry - expiry;

    assert.deepEqual(cached.item.body, defaultResponse.body);
    assert(differenceInExpires < 1000);
  });

  it('does not create cache entries for critical errors', async () => {
    const catbox = createCache();

    api.get('/').reply(500, defaultResponse.body, defaultHeaders);

    await httpTransport
      .createClient()
      .use(cache.maxAge(catbox))
      .get('http://www.example.com/')
      .asResponse();

    const cached = await catbox.get(bodySegment);

    assert.isNull(cached);
  });

  it('does create cache entries for client errors', async () => {
    const catbox = createCache();

    api.get('/').reply(404, defaultResponse.body, defaultHeaders);

    await httpTransport
      .createClient()
      .use(cache.maxAge(catbox))
      .get('http://www.example.com/')
      .asResponse();

    const cached = await catbox.get(bodySegment);

    assert.deepEqual(cached.item.body, defaultResponse.body);
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

    const cachedItem = await nearCache.get(bodySegment);

    assert.isBelow(cachedItem.ttl, 59950);
  });

  it('ignore cache lookup errors', async () => {
    const catbox = createCache();
    sandbox.stub(catbox, 'get').rejects(new Error('error'));

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const body = await httpTransport
      .createClient()
      .use(cache.maxAge(catbox, { ignoreCacheErrors: true }))
      .get('http://www.example.com/')
      .asBody();

    assert.equal(body, defaultResponse.body);
  });

  it('timeouts a cache lookup', async () => {
    const catbox = createCache();
    const cacheLookupComplete = false;
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    sandbox.stub(catbox, 'get').callsFake(async () => {
      return await bluebird.delay(100);
    });

    const timeout = 10;
    try {
      await httpTransport
        .createClient()
        .use(cache.maxAge(catbox, { timeout }))
        .get('http://www.example.com/')
        .asBody();
    } catch (err) {
      assert.isFalse(cacheLookupComplete);
      return assert.equal(err.message, `Cache timed out after ${timeout}`);
    }
    assert.fail('Expected to throw');
  });

  it('ignores cache timeout error and requests from the system of record.', async () => {
    const catbox = createCache();
    let cacheLookupComplete = false;

    sandbox.stub(catbox, 'get').callsFake(async () => {
      await bluebird.delay(100);
      cacheLookupComplete = true;
    });
    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const timeout = 10;
    let body;
    try {
      body = await httpTransport
        .createClient()
        .use(cache.maxAge(catbox, { timeout, ignoreCacheErrors: true }))
        .get('http://www.example.com/')
        .asBody();
    } catch (err) {
      return assert.fail(null, null, 'Failed on timeout');
    }
    assert.isFalse(cacheLookupComplete);
    assert.equal(body, defaultResponse.body);
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

    async function assertGetOnly(method) {
      let invoked = false;
      const cache = createCache();

      sandbox.stub(cache, 'get').resolves({
        item: { revalidate: Date.now() - 1000 }
      });

      const opts = {
        'staleWhileRevalidate': true,
        refresh: async () => {
          invoked = true;
          return;
        }
      };

      const client = createCacheClient(cache, opts);
      await client[method]('http://www.example.com/', {}).asResponse();

      assert.isFalse(invoked);
    }

    async function assertSWRMaxAge(method) {
      const maxage = 60;
      const swr = maxage * 2;
      api[method]('/')
        .reply(200, defaultResponse.body, { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` });

      const cache = createCache();
      sandbox.stub(cache, 'set').resolves();

      const client = createCacheClient(cache, { 'staleWhileRevalidate': true });
      await client[method]('http://www.example.com/', {}).asResponse();

      sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, maxage * 1000);
    }

    it('increases the max-age by the stale-while-revalidate value', async () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').resolves();

      const maxage = 60;
      const swr = maxage * 2;
      nockAPI(maxage, swr);

      await requestWithCache(cache, { 'staleWhileRevalidate': true });

      sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, (maxage + swr) * 1000);
    });

    it('does not increase max-age for PUT requests', async () => {
      await assertSWRMaxAge('put');
    });

    it('does not increase max-age for DELETE requests', async () => {
      await assertSWRMaxAge('delete');
    });

    it('does not increase max-age for POST requests', async () => {
      await assertSWRMaxAge('post');
    });

    it('does not increase max-age for HEAD requests', async () => {
      await assertSWRMaxAge('head');
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
      await bluebird.delay((maxage * 1000));
      await requestWithCache(cache, opts);
      await bluebird.delay(50);
      const cached = await cache.get(bodySegment);

      assert.equal(cached.item.body, 'We ALL love jonty');
    });

    it('does not update cache for failed requests', async () => {
      const cache = createCache();
      const refreshClient = httpTransport.createClient();

      const maxage = 1;
      const swr = maxage * 2;
      const responseHeaders = { 'cache-control': `max-age=${maxage},stale-while-revalidate=${swr}` };

      api
        .get('/')
        .reply(200, 'First Response', responseHeaders);

      api
        .get('/')
        .reply(500, 'Second Response', responseHeaders);

      const opts = {
        'staleWhileRevalidate': true,
        refresh: () => {
          return refreshClient.get('http://www.example.com/').asResponse();
        }
      };

      await requestWithCache(cache, opts);
      await bluebird.delay((maxage * 1000));
      await requestWithCache(cache, opts);
      await bluebird.delay(100);

      const cached = await cache.get(bodySegment);
      assert.equal(cached.item.body, 'First Response');
    });

    it('does not revalidate for PUT requests', async () => {
      assertGetOnly('put');
    });

    it('does not revalidate for POST requests', async () => {
      assertGetOnly('post');
    });

    it('does not revalidate for DELETE requests', async () => {
      assertGetOnly('delete');
    });

    it('does not revalidate for HEAD requests', async () => {
      assertGetOnly('head');
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
      await bluebird.delay(maxAge * 1000);
      await requestWithCache(cache, opts);
      await bluebird.delay(delay);
      const cached = await cache.get(bodySegment);
      const ttl = cached.ttl;
      assert(ttl < maxAge * 1000);
      assert(ttl > (maxAge * 1000) - delay - tolerance);
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

      const cachedItem = await nearCache.get(bodySegment);
      assert.isBelow(cachedItem.ttl, 29900);
    });

    it('does not use stale-while-revalidate when set to 0', async () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').resolves();
      const maxage = 1;
      const swr = 0;
      nockAPI(maxage, swr);

      await requestWithCache(cache, { 'staleWhileRevalidate': true });
      await cache.get(bodySegment);

      sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, maxage * 1000);
    });

    it('does not use stale-while-revalidate if disabled', async () => {
      const cache = createCache();
      sandbox.stub(cache, 'set').resolves();

      const maxage = 1;
      const swr = 7200;
      nockAPI(maxage, swr);

      await requestWithCache(cache, { 'stale-while-revalidate': false });
      await cache.get(bodySegment);
      sinon.assert.calledWith(cache.set, sinon.match.object, sinon.match.object, maxage * 1000);
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
    it('keys cache entries by method and url', async () => {
      const cache = createCache();
      api.get('/some-cacheable-path').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      await createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path')
        .asResponse();

      const cached = await cache.get({
        segment: `http-transport:${VERSION}:body`,
        id: 'GET:http://www.example.com/some-cacheable-path'
      });

      const actualExpiry = cached.ttl + cached.stored;
      const differenceInExpires = actualExpiry - expiry;

      assert.deepEqual(cached.item.body, defaultResponse.body);
      assert(differenceInExpires < 1000);
    });

    it('keys cache entries by url including query strings in request url', async () => {
      const cache = createCache();
      api.get('/some-cacheable-path?d=ank').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      await createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path?d=ank')
        .asResponse();

      const cached = await cache.get({
        segment: `http-transport:${VERSION}:body`,
        id: 'GET:http://www.example.com/some-cacheable-path?d=ank'
      });

      const actualExpiry = cached.ttl + cached.stored;
      const differenceInExpires = actualExpiry - expiry;

      assert.deepEqual(cached.item.body, defaultResponse.body);
      assert(differenceInExpires < 1000);
    });

    it('keys cache entries by url including query strings in query object', async () => {
      const cache = createCache();
      api.get('/some-cacheable-path?d=ank').reply(200, defaultResponse.body, defaultHeaders);

      const expiry = Date.now() + 60000;

      await createCacheClient(cache)
        .get('http://www.example.com/some-cacheable-path')
        .query('d', 'ank')
        .asResponse();

      const cached = await cache.get({
        segment: `http-transport:${VERSION}:body`,
        id: 'GET:http://www.example.com/some-cacheable-path?d=ank'
      });

      const actualExpiry = cached.ttl + cached.stored;
      const differenceInExpires = actualExpiry - expiry;

      assert.deepEqual(cached.item.body, defaultResponse.body);
      assert(differenceInExpires < 1000);
    });
  });

  it('does not store if no cache-control', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse);

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('does not store if max-age=0', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'max-age=0'
      }
    });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('returns a cached response when available', async () => {
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

    await cache.start();
    await cache.set(bodySegment, cachedResponse, 600);
    const res = await requestWithCache(cache);

    assert.equal(res.body, cachedResponse.body);
    assert.deepEqual(res.headers, cachedResponse.headers);
    assert.equal(res.statusCode, cachedResponse.statusCode);
    assert.equal(res.url, cachedResponse.url);
    assert.equal(res.elapsedTime, cachedResponse.elapsedTime);

    await cache.drop(bodySegment);
  });

  describe('Events', () => {
    it('emits events with name when name option is present', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheMiss = false;
      events.on('cache.ceych.miss', () => {
        cacheMiss = true;
      });

      const opts = {
        name: 'ceych'
      };

      await requestWithCache(cache, opts);
      assert.ok(cacheMiss);
    });

    it('emits a cache miss event', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheMiss = false;
      events.on('cache.miss', () => {
        cacheMiss = true;
      });

      await requestWithCache(cache);
      assert.ok(cacheMiss);
    });

    it('emits a cache hit event', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse.body, defaultHeaders);

      let cacheHit = false;
      events.on('cache.hit', () => {
        cacheHit = true;
      });

      await requestWithCache(cache);
      await requestWithCache(cache);
      assert.ok(cacheHit);
    });
  });
});
