'use strict';

const assert = require('chai').assert;
const httpTransport = require('@bbc/http-transport');
const Catbox = require('@hapi/catbox');
const Memory = require('@hapi/catbox-memory').Engine;
const nock = require('nock');
const bluebird = require('bluebird');
const sinon = require('sinon');

const sandbox = sinon.createSandbox();
const cache = require('../');
const { events } = cache;

const api = nock('http://www.example.com');

const VERSION = require('../config').cache.version;

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

function createCacheClient(catbox, opts, existingCacheMiddleware) {
  const cacheMiddlware = existingCacheMiddleware || cache.maxAge(catbox, opts);
  return httpTransport.createClient()
    .use(cacheMiddlware);
}

function requestWithClient(client) {
  return client
    .get('http://www.example.com/')
    .asResponse();
}

async function requestWithCache(catbox, opts, cacheMiddlware) {
  return requestWithClient(createCacheClient(catbox, opts, cacheMiddlware));
}

describe('Max-Age', () => {
  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('starts the cache if it\'s not already started', async () => {
    const cache = createCache();
    sandbox.spy(cache, 'start');

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    await requestWithCache(cache);

    sandbox.assert.called(cache.start);
  });

  it('throws the error that starting the cache throws', async () => {
    api.get('/').thrice().reply(200, defaultResponse.body, defaultHeaders);
    const cache = createCache();

    const expectedErrorMessage = 'Error starting da cache';
    sandbox.stub(cache, 'start').rejects(new Error(expectedErrorMessage));

    try {
      await requestWithCache(cache, { ignoreCacheErrors: false });
      throw new Error('error');
    } catch (error) {
      assert.equal(error.message, expectedErrorMessage);
    }
  });

  it('times out a request if cache does not start', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'start').callsFake(async () => {
      await bluebird.delay(100);
      throw new Error('We should never get this error');
    });

    const connectionTimeout = 10;

    try {
      await requestWithCache(cache, { ignoreCacheErrors: false, connectionTimeout });
    } catch (error) {
      assert.equal(error.message, 'Starting cache timed out after 10');
    }
  });

  it('does not throw the error that starting the cache throws and continues to next middleware when ignoreCacheErrors is true', async () => {
    const catbox = createCache();
    const startError = new Error('Error starting da cache');
    sandbox.stub(catbox, 'start').rejects(startError);
    api.get('/').thrice().reply(200, defaultResponse.body, defaultHeaders);

    let called = false;
    function requestWithCacheAndNextMiddleware() {
      return httpTransport
        .createClient()
        .use(cache.maxAge(catbox, { ignoreCacheErrors: true }))
        .use((ctx, next) => {
          called = true;
          return next();
        })
        .get('http://www.example.com/')
        .asResponse();
    }

    try {
      await requestWithCacheAndNextMiddleware();
    } catch (error) {
      throw error;
    }
    assert.equal(called, true, 'Expected the next middleware to be called');
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

  it('stores cached values for the defaultTTL value if provided and there is no "max-age"', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, {});

    const expiry = Date.now() + 90000;

    await requestWithCache(cache, { defaultTTL: 90 });
    const cached = await cache.get(bodySegment);
    const actualExpiry = cached.ttl + cached.stored;
    const differenceInExpires = actualExpiry - expiry;

    assert.deepEqual(cached.item.body, defaultResponse.body);
    assert(differenceInExpires < 1000);
  });

  it('only caches for "max-age" when no other directives are specified', async () => {
    const catbox = new Catbox.Client(new Memory());
    sandbox.stub(catbox, 'get').resolves();
    sandbox.stub(catbox, 'set').resolves();

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    await httpTransport
      .createClient()
      .use(cache.maxAge(catbox))
      .use(cache.staleIfError(catbox))
      .get('http://www.example.com/')
      .asResponse();

    sinon.assert.calledWith(catbox.set, bodySegment);
    sinon.assert.callCount(catbox.set, 1);
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

  it('does not store in cache if cache read fails when ignoring cache errors', async () => {
    const catbox = createCache();
    sandbox.stub(catbox, 'get').rejects(new Error('error2'));
    sandbox.stub(catbox, 'set');

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    await httpTransport
      .createClient()
      .use(cache.maxAge(catbox, { ignoreCacheErrors: true }))
      .get('http://www.example.com/')
      .asBody();

    sinon.assert.notCalled(catbox.set);
  });

  it('does not store in cache if cache read fails', async () => {
    const catbox = createCache();
    sandbox.stub(catbox, 'get').rejects(new Error('error2'));
    sandbox.stub(catbox, 'set');

    api.get('/').reply(200, defaultResponse.body, defaultHeaders);

    try {
      await httpTransport
        .createClient()
        .use(cache.maxAge(catbox))
        .get('http://www.example.com/')
        .asBody();
    } catch (error) {
      sinon.assert.notCalled(catbox.set);
      return;
    }
    assert.fail('Expected to throw');
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
      return assert.equal(err.message, `Cache get timed out after ${timeout}ms - url: http://www.example.com/ - segment: body`);
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

    it('keys cache entries by method and url with the additional varyOn keys and values if matched with the request headers', async () => {
      const headers = {
        'cache-control': 'max-age=60',
        'accept-language': 'en',
        accept: 'application/json'
      };
      const cache = createCache();
      api.get('/some-cacheable-path').reply(200, defaultResponse.body, headers);

      const expiry = Date.now() + 60000;

      const opts = {
        varyOn: [
          'accept-language',
          'accept'
        ]
      };

      await createCacheClient(cache, opts)
        .headers(headers)
        .get('http://www.example.com/some-cacheable-path')
        .asResponse();

      const cached = await cache.get({
        segment: `http-transport:${VERSION}:body`,
        id: 'GET:http://www.example.com/some-cacheable-path:accept-language=en,accept=application/json'
      });

      const actualExpiry = cached.ttl + cached.stored;
      const differenceInExpires = actualExpiry - expiry;

      assert.deepEqual(cached.item.body, defaultResponse.body);
      assert(differenceInExpires < 1000);
    });

    it('keys cache entries by method and url with the additional varyOn keys and empty values if not matched with the request headers', async () => {
      const headers = {
        'cache-control': 'max-age=60',
        'accept-language': 'en',
        accept: 'application/json'
      };
      const cache = createCache();
      api.get('/some-cacheable-path').reply(200, defaultResponse.body, headers);

      const expiry = Date.now() + 60000;

      const opts = {
        varyOn: [
          'some-rand-header-a',
          'some-rand-header-b'
        ]
      };

      await createCacheClient(cache, opts)
        .headers(headers)
        .get('http://www.example.com/some-cacheable-path')
        .asResponse();

      const cached = await cache.get({
        segment: `http-transport:${VERSION}:body`,
        id: 'GET:http://www.example.com/some-cacheable-path:some-rand-header-a=,some-rand-header-b='
      });

      const actualExpiry = cached.ttl + cached.stored;
      const differenceInExpires = actualExpiry - expiry;

      assert.deepEqual(cached.item.body, defaultResponse.body);
      assert(differenceInExpires < 1000);
    });
  });

  it('does not store if cache control headers are non numbers', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, { 'cache-control': 'max-age=NAN' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('does not store if no cache-control', async () => {
    const cache = createCache();
    api.get('/').reply(200, defaultResponse.body, {});

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert(!cached);
  });

  it('does not store if max-age=0', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'max-age=0' });

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

  it('does not store if no-store', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'no-store' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert.isNull(cached);
  });

  it('does not store if private', async () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, { 'cache-control': 'private' });

    await requestWithCache(cache);
    const cached = await cache.get(bodySegment);
    assert.isNull(cached);
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

    it('emits a connection_error event with error when cache.start fails', async () => {
      api.get('/').reply(200, 'ok');
      let cacheConnectionError = null;
      events.on('cache.connection_error', (ctx, err) => {
        cacheConnectionError = err;
      });
      const catboxCache = createCache();
      const connectionTimeout = 10;

      const opts = {
        ignoreCacheErrors: true,
        connectionTimeout
      };
      const middleware = cache.maxAge(catboxCache, opts);

      sandbox.stub(catboxCache, 'start').callsFake(async () => {
        throw new Error('fake error');
      });
      sandbox.stub(catboxCache, 'isReady').returns(false);

      await requestWithCache(catboxCache, opts, middleware);

      assert(cacheConnectionError instanceof Error, 'expected error to have been emitted');
      assert.strictEqual(cacheConnectionError.message, 'fake error');
    });

    it('returns a context from a cache hit event emission', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse, defaultHeaders);

      let context;
      events.on('cache.hit', (ctx) => {
        context = ctx;
      });

      await requestWithCache(cache);
      await requestWithCache(cache);

      assert.instanceOf(context, httpTransport.context);
    });

    it('returns a context from a cache miss event emission', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse, defaultHeaders);

      let context;
      events.on('cache.miss', (ctx) => {
        context = ctx;
      });

      await requestWithCache(cache);

      assert.instanceOf(context, httpTransport.context);
    });

    it('returns a context from a cache timeout event emission', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse, defaultHeaders);

      sandbox.stub(cache, 'get').callsFake(async () => {
        await bluebird.delay(100);
      });

      let context;
      events.on('cache.timeout', (ctx) => {
        context = ctx;
      });

      try {
        await requestWithCache(cache, { timeout: 10 });
      } catch (err) {
        return assert.instanceOf(context, httpTransport.context);
      }

      assert.fail('Expected to throw');
    });

    it('returns a context from a cache error event emission', async () => {
      const cache = createCache();
      api.get('/').reply(200, defaultResponse, defaultHeaders);

      sandbox.stub(cache, 'get').rejects(new Error('error'));

      let context;
      events.on('cache.error', (ctx) => {
        context = ctx;
      });

      try {
        await requestWithCache(cache);
      } catch (err) {
        return assert.instanceOf(context, httpTransport.context);
      }

      assert.fail('Expected to throw');
    });
  });
});
