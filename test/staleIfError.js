'use strict';

const assert = require('chai').assert;
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const nock = require('nock');
const bluebird = require('bluebird');

const sinon = require('sinon');

const httpTransport = require('@bbc/http-transport');
const toError = require('@bbc/http-transport-to-error');

const cache = require('../');
const events = require('../').events;

const VERSION = require('../package').version;
const api = nock('http://www.example.com');

const sandbox = sinon.sandbox.create();

const defaultHeaders = {
  'cache-control': 'max-age=60,stale-if-error=7200'
};

const defaultResponse = {
  body: 'I am a string!',
  url: 'http://www.example.com/',
  statusCode: 200,
  elapsedTime: 40,
  headers: defaultHeaders
};

const bodySegment = {
  segment: `http-transport:${VERSION}:stale`,
  id: 'GET:http://www.example.com/'
};

nock.disableNetConnect();

function createCache() {
  return new Catbox.Client(new Memory());
}

function requestWithCache(catbox, opts) {
  return httpTransport
    .createClient()
    .use(cache.staleIfError(catbox, opts))
    .use(toError())
    .get('http://www.example.com/')
    .asResponse();
}

describe('Stale-If-Error', () => {
  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('stores cached values for the stale-if-error value', async () => {
    const cache = createCache();
    await cache.start();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const maxAge = 60000;
    const staleIfError = 7200000;
    const expiry = Date.now() + maxAge + staleIfError;

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    const actualExpiry = cached.ttl + cached.stored;
    const differenceInExpires = actualExpiry - expiry;

    assert.deepEqual(cached.item.body, defaultResponse.body);
    assert(differenceInExpires < 1000 && differenceInExpires >= 0);
  });

  it('does not create cache entries for critical errors', async () => {
    const catbox = createCache();

    api.get('/').reply(500, defaultResponse.body, defaultHeaders);

    await httpTransport
      .createClient()
      .use(cache.staleIfError(catbox))
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
      .use(cache.staleIfError(catbox))
      .get('http://www.example.com/')
      .asResponse();

    const cached = await catbox.get(bodySegment);
    assert.deepEqual(cached.item.body, defaultResponse.body);
  });

  it('does not create cache entries for items fetched from another cache', async () => {
    const nearCache = createCache();
    const farCache = createCache();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    const client = httpTransport.createClient();

    // populate the far-away cache first
    await client
      .use(cache.staleIfError(farCache))
      .get('http://www.example.com/')
      .asResponse();

    // response will originate from the far-away cache
    await client
      .use(cache.staleIfError(nearCache))
      .use(cache.staleIfError(farCache))
      .get('http://www.example.com/')
      .asResponse();

    const cachedItem = await nearCache.get(bodySegment);
    assert.isNull(cachedItem);
  });

  it('does not store if no cache-control', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse);

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('does not store if stale-if-error=0', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'stale-if-error=0' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert.equal(cached, null);
  });

  it('does not store if no-store', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'no-store' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert.equal(cached, null);
  });

  it('does not store if private', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'private' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert.equal(cached, null);
  });

  it('stores even if no max-age', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'stale-if-error=7200' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(cached);
  });

  it('does not store if cache control headers are non numbers', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, { 'cache-control': 'stale-if-error =NAN' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('returns cached response if available when error response is returned', async () => {
    const cachedResponse = {
      body: 'http-transport',
      headers: defaultHeaders,
      elapsedTime: 40,
      url: 'http://www.example.com/',
      statusCode: 200
    };
    const cache = createCache();

    api.get('/').reply(500, defaultResponse.body, {});

    await cache.start();
    await cache.set(bodySegment, cachedResponse, 7200);
    const res = await requestWithCache(cache);

    assert.equal(res.body, cachedResponse.body);
    assert.deepEqual(res.headers, cachedResponse.headers);
    assert.equal(res.elapsedTime, cachedResponse.elapsedTime);
    assert.equal(res.url, cachedResponse.url);
    assert.equal(res.statusCode, cachedResponse.statusCode);

    return cache.drop(bodySegment);
  });
  it('returns the original error if nothing in cache', async () => {
    const cache = createCache();
    api.get('/').reply(500, defaultResponse, {});

    try {
      await requestWithCache(cache);

    } catch (err) {
      return assert.equal(err.message, 'Received HTTP code 500 for GET http://www.example.com/');
    }
    assert.fail('Expected to throw');
  });

  it('returns an error if the cache lookup fails', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('cache lookup error'));

    try {
      await requestWithCache(cache);

    } catch (err) {
      return assert.equal(err.message, 'cache lookup error');
    }
    assert.fail('Expected to throw');
  });

  it('returns the original error if "ignoreCacheErrors" is true', async () => {
    const cache = createCache();
    api.get('/').reply(500, defaultResponse, {});
    sandbox.stub(cache, 'get').rejects(new Error('cache lookup error'));

    try {
      await requestWithCache(cache, { ignoreCacheErrors: true });
    } catch (err) {
      return assert.equal(err.message, 'Received HTTP code 500 for GET http://www.example.com/');
    }
    assert.fail('Expected to throw');
  });

  it('continues to the next middleware when there\'s an error and no error handler', async () => {
    const catbox = createCache();

    api.get('/').reply(500, defaultResponse.body, defaultHeaders);

    let called = false;
    await httpTransport
      .createClient()
      .use(cache.staleIfError(catbox))
      .use((ctx, next) => {
        called = true;
        return next();
      })
      .get('http://www.example.com/')
      .asResponse();

    assert.ok(called);
  });

  describe('Events', () => {
    const cachedResponse = {
      body: 'http-transport',
      headers: defaultHeaders,
      elapsedTime: 40,
      url: 'http://www.example.com/',
      statusCode: 200
    };

    it('emits a stale cache event when returning stale', async () => {
      let cacheStale = false;
      events.on('cache.stale', () => {
        cacheStale = true;
      });

      const cache = createCache();

      api.get('/').reply(500, defaultResponse.body, {});

      await cache.start();
      await cache.set(bodySegment, cachedResponse, 7200);
      await requestWithCache(cache);
      assert.ok(cacheStale);
    });

    it('emits a stale cache event with cache name when present', async () => {
      const opts = {
        name: 'ceych'
      };

      let cacheStale = false;
      events.on('cache.ceych.stale', () => {
        cacheStale = true;
      });

      const cache = createCache();

      api.get('/').reply(500, defaultResponse.body, {});

      await cache.start();
      await cache.set(bodySegment, cachedResponse, 7200);
      await requestWithCache(cache, opts);

      assert.ok(cacheStale);
    });

    it('emits a stale cache event with the correct context', async () => {
      const opts = {
        name: 'ceych'
      };

      let context;
      events.on('cache.ceych.stale', (ctx) => {
        context = ctx;
      });

      const cache = createCache();

      api.get('/').reply(500, defaultResponse.body, {});

      await cache.start();
      await cache.set(bodySegment, cachedResponse, 7200);
      await requestWithCache(cache, opts);

      assert.instanceOf(context, httpTransport.context);
    });

    it('emits a timeout cache event with the correct context', async () => {
      const cache = createCache();
      api.get('/').reply(500, defaultResponse, defaultHeaders);

      sandbox.stub(cache, 'get').callsFake(async () => {
        await bluebird.delay(100);
      });

      let context;
      events.on('cache.timeout', (ctx) => {
        context = ctx;
      });

      await cache.start();
      await cache.set(bodySegment, cachedResponse, 7200);

      try {
        await requestWithCache(cache, { timeout: 10 });
      } catch (err) {
        return assert.instanceOf(context, httpTransport.context);
      }

      assert.fail('Expected to throw');
    });

    it('emits a cache error event with the correct context', async () => {
      const cache = createCache();
      api.get('/').reply(500, defaultResponse, defaultHeaders);

      sandbox.stub(cache, 'get').rejects(new Error('error'));

      let context;
      events.on('cache.error', (ctx) => {
        context = ctx;
      });

      await cache.start();
      await cache.set(bodySegment, cachedResponse, 7200);

      try {
        await requestWithCache(cache);
      } catch (err) {
        return assert.instanceOf(context, httpTransport.context);
      }

      assert.fail('Expected to throw');
    });
  });
});
