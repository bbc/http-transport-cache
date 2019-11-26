'use strict';

const assert = require('chai').assert;
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const bluebird = require('bluebird');
const sinon = require('sinon');

const { getFromCache, storeInCache } = require('../lib/cache');
const { events } = require('../');

const sandbox = sinon.createSandbox();
const SEGMENT = 'body';
const VERSION = require('../package').version;
const bodySegment = {
  segment: `http-transport:${VERSION}:body`,
  id: 'GET:http://www.example.com/'
};

const cachedResponse = {
  body: 'http-transport',
  statusCode: 200,
  url: 'http://www.example.com/',
  elapsedTime: 40
};

function createCache() {
  return new Catbox.Client(new Memory());
}

const ctx = {
  req: {
    getMethod() {
      return 'GET';
    },
    getUrl() {
      return 'http://www.example.com/';
    }
  }
};

describe('Cache', () => {
  beforeEach(() => {
    sandbox.stub(events, 'on').returns();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns a cached value', async () => {
    const cache = createCache();
    await cache.start();

    await cache.set(bodySegment, cachedResponse, 600);
    const cached = await getFromCache(cache, SEGMENT, ctx);
    assert.deepEqual(cached.item, cachedResponse);
  });

  it('stores a value in the cache', async () => {
    const cache = createCache();
    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, { a: 1 }, 600);
    const cached = await getFromCache(cache, SEGMENT, ctx);
    assert.deepEqual(cached.item, { a: 1 });
  });

  it('returns an error', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    await cache.start();

    try {
      await getFromCache(cache, SEGMENT, ctx);
    } catch (err) {
      return assert.equal(err.message, 'error');
    }
    assert.fail();
  });

  it('returns the value when set throws', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'set').rejects(new Error('Cache size limit reached'));

    await cache.start();
    const value = await storeInCache(cache, SEGMENT, ctx, { a: 1 }, 600);
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
      await getFromCache(cache, SEGMENT, ctx, { timeout });
    } catch (err) {
      assert.isFalse(cacheLookupComplete);
      return assert.equal(err.message, `Cache timed out after ${timeout}`);
    }
    assert.fail();
  });

  it('times out a set request', async () => {
    const cache = createCache();
    const body = { a: 1 };

    let cacheSetComplete = false;
    sandbox.stub(cache, 'set').callsFake(async () => {
      await bluebird.delay(100);
      cacheSetComplete = true;
    });

    const timeout = 10;
    const storeResult = await storeInCache(cache, SEGMENT, ctx, body, 600, { timeout });

    assert.isFalse(cacheSetComplete);
    assert.equal(storeResult, body);
  });

  it('returns a cache miss when "ignoreCacheErrors" is true', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('cache lookup failed!'));
    await cache.start();

    const cached = await getFromCache(cache, SEGMENT, ctx, { ignoreCacheErrors: true });
    assert.isNull(cached);
  });
});

describe('events', () => {
  it('emits a time stats event when storing a value in the cache', async () => {
    let writeDuration;
    const opts = {
      name: 'whatever'
    };
    events.on(`cache.${opts.name}.write_time`, (duration) => {
      writeDuration = duration;
    });

    const cache = createCache();
    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, { a: 1 }, 600, opts);

    assert.isNumber(writeDuration);
  });

  it('emits a time stats when getting a value from the cache', async () => {
    let readDuration;
    const opts = {
      name: 'whatever'
    };
    events.on(`cache.${opts.name}.read_time`, (duration) => {
      readDuration = duration;
    });
    const cache = createCache();
    await cache.start();
    await cache.set(bodySegment, cachedResponse, 600);
    await getFromCache(cache, SEGMENT, ctx, opts);
    assert.isNumber(readDuration);
  });

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
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50 });
    } catch (err) {
      return assert.deepStrictEqual(eventContext, ctx);
    }
    assert.fail();
  });

  it('emits a timeout event when set timeout occurs', async () => {
    const cache = createCache();
    const body = { a: 1 };

    sandbox.stub(cache, 'set').callsFake(async () => {
      await bluebird.delay(100);
    });

    let eventContext;
    events.on('cache.timeout', (ctx) => {
      eventContext = ctx;
    });

    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, body, 600, { timeout: 10 });

    assert.deepStrictEqual(eventContext, ctx);
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
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50 });
    } catch (err) {
      return assert.deepStrictEqual(eventContext, ctx);
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
      await getFromCache(cache, SEGMENT, ctx, opts);
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
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50 });
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
      await getFromCache(cache, SEGMENT, ctx);
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
    await storeInCache(cache, SEGMENT, ctx, { a: 1 }, 600);
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
    await getFromCache(cache, SEGMENT, ctx, { ignoreCacheErrors: true });
    assert.ok(cacheError);
  });
});
