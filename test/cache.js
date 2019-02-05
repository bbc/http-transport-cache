'use strict';

const assert = require('chai').assert;
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const bluebird = require('bluebird');
const sinon = require('sinon');

const { getFromCache, storeInCache } = require('../lib/cache');
const { events } = require('../');

const sandbox = sinon.sandbox.create();
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
  return new Catbox.Client(new Memory());
}

describe('Cache', () => {
  afterEach(() => {
    sandbox.restore();
  });

  it('returns a cached value', async () => {
    const cache = createCache();
    await cache.start();

    await cache.set(bodySegment, cachedResponse, 600);
    const cached = await getFromCache(cache, SEGMENT, ID);
    assert.deepEqual(cached.item, cachedResponse);
  });

  it('stores a value in the cache', async () => {
    const cache = createCache();
    await cache.start();
    await storeInCache(cache, SEGMENT, ID, { a: 1 }, 600);
    const cached = await getFromCache(cache, SEGMENT, ID);
    assert.deepEqual(cached.item, { a: 1 });
  });

  it('returns an error', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    await cache.start();

    try {
      await getFromCache(cache, SEGMENT, ID);
    } catch (err) {
      return assert.equal(err.message, 'error');
    }
    assert.fail();
  });

  it('returns the value when set throws', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'set').rejects(new Error('Cache size limit reached'));

    await cache.start();
    const value = await storeInCache(cache, SEGMENT, ID, { a: 1 }, 600);
    assert.deepEqual(value, { a: 1 });
  });

  it('times out a request', async () => {
    const cache = createCache();
    let cacheLookupComplete = false;
    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
      cacheLookupComplete = true;
    });

    const timeout = 10;
    try {
      await getFromCache(cache, SEGMENT, ID, { timeout });
    } catch (err) {
      assert.isFalse(cacheLookupComplete);
      return assert.equal(err.message, `Cache timed out after ${timeout}`);
    }
    assert.fail();
  });

  it('returns a cache miss when "ignoreCacheErrors" is true', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('cache lookup failed!'));
    await cache.start();

    const cached = await getFromCache(cache, SEGMENT, ID, { ignoreCacheErrors: true });
    assert.isNull(cached);
  });
});

describe('events', () => {
  const expectedContext = { context: 'context' };
  it('emits a timeout event with correct context', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
    });

    let eventContext;
    events.on('cache.timeout', (ctx) => {
      eventContext = ctx;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ID, { timeout: 50 }, expectedContext);
    } catch (err) {
      return assert.deepStrictEqual(eventContext, expectedContext);
    }
    assert.fail();
  });

  it('emits a cache error event with correct context', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    let eventContext;
    events.on('cache.error', (ctx) => {
      eventContext = ctx;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ID, { timeout: 50 }, expectedContext);
    } catch (err) {
      return assert.deepStrictEqual(eventContext, expectedContext);
    }
    assert.fail();
  });

  it('emits events with the cache name when present', async () => {
    const cache = createCache();
    let cacheTimeout = false;

    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
      cacheTimeout = true;
    });

    events.on('cache.ceych.timeout', () => {
      cacheTimeout = true;
    });

    const opts = {
      name: 'ceych',
      timeout: 50
    };

    await cache.start();

    try {
      await getFromCache(cache, SEGMENT, ID, opts);
    } catch (err) {
      return assert.ok(cacheTimeout);
    }
    assert.fail();
  });

  it('emits a timeout event', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
    });

    let cacheTimeout = false;
    events.on('cache.timeout', () => {
      cacheTimeout = true;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ID, { timeout: 50 });
    } catch (err) {
      return assert.ok(cacheTimeout);
    }
    assert.fail();
  });

  it('emits a cache error event', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    let cacheError = false;
    events.on('cache.error', () => {
      cacheError = true;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ID);
    } catch (err) {
      return assert.ok(cacheError);
    }
    assert.fail();
  });

  it('emits a cache error event when set throws', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'set').rejects(new Error('error'));

    let cacheError = false;
    events.on('cache.error', () => {
      cacheError = true;
    });

    await cache.start();
    await storeInCache(cache, SEGMENT, ID, { a: 1 }, 600);
    assert.ok(cacheError);
  });

  it('emits a cache error event when "ignoreCacheErrors" is true', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    let cacheError = false;
    events.on('cache.error', () => {
      cacheError = true;
    });

    await cache.start();
    await getFromCache(cache, SEGMENT, ID, { ignoreCacheErrors: true });
    assert.ok(cacheError);
  });
});
