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
    await storeInCache(cache, SEGMENT, ctx, body, 600, { timeout });

    assert.isFalse(cacheSetComplete);
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

  it('sets the cacheStatus variable in context from a cache timeout', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
    });

    let eventContext;
    events.on('cache.timeout', (ctx) => {
      eventContext = ctx;
    });

    const includeCacheStatusInCtx = true;
    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50, includeCacheStatusInCtx });
    } catch (err) {
      assert.equal(ctx.cacheStatus, 'timeout');
      return assert.deepStrictEqual(eventContext, ctx);
    }
    assert.fail();
  });

  it('emits a timeout event with correct error object', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').callsFake(async () => {
      await bluebird.delay(100);
    });

    let emmitedError;
    events.on('cache.timeout', (ctx, err) => {
      emmitedError = err;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50 });
    } catch (err) {
      return assert.deepStrictEqual(emmitedError, err);
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

  it('sets the cacheStatus variable in context when storing in cache times out', async () => {
    const cache = createCache();
    const body = { a: 1 };

    sandbox.stub(cache, 'set').callsFake(async () => {
      await bluebird.delay(100);
    });

    let eventContext;
    events.on('cache.timeout', (ctx) => {
      eventContext = ctx;
    });
    const includeCacheStatusInCtx = true;
    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, body, 600, { timeout: 10, includeCacheStatusInCtx });

    assert.equal(ctx.cacheStatus, 'timeout');
    assert.deepStrictEqual(eventContext, ctx);
  });

  it('emits a timeout event with the correct error object when set timeout occurs', async () => {
    const cache = createCache();
    const body = { a: 1 };

    sandbox.stub(cache, 'set').callsFake(async () => {
      await bluebird.delay(100);
    });

    let emmitedError;
    events.on('cache.timeout', (ctx, err) => {
      emmitedError = err;
    });

    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, body, 600, { timeout: 10 });

    assert.deepEqual(emmitedError.message, 'Cache timed out after 10');
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

  it('sets the cacheStatus variable in context from a cache timeout', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    let eventContext;
    events.on('cache.error', (ctx) => {
      eventContext = ctx;
    });

    const includeCacheStatusInCtx = true;
    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50, includeCacheStatusInCtx });
    } catch (err) {
      assert.equal(ctx.cacheStatus, 'error');
      return assert.deepStrictEqual(eventContext, ctx);
    }
    assert.fail();
  });

  it('emits a cache error event with correct error object', async () => {
    const cache = createCache();
    const errorObject = new Error('error');
    sandbox.stub(cache, 'get').rejects(errorObject);

    let errorEmitted;
    events.on('cache.error', (ctx, err) => {
      errorEmitted = err;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ctx, { timeout: 50 });
    } catch (err) {
      return assert.deepStrictEqual(errorEmitted, errorObject);
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

  it('sets the cacheStatus variable in context when storing in cache errors', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'set').rejects(new Error('error'));

    let cacheError = false;
    events.on('cache.error', () => {
      cacheError = true;
    });

    const includeCacheStatusInCtx = true;
    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, { a: 1, includeCacheStatusInCtx }, 600);
    assert.equal(ctx.cacheStatus, 'error');
    assert.ok(cacheError);
  });

  it('emits a cache error event with correct error object', async () => {
    const cache = createCache();
    const errorObject = new Error('error');
    sandbox.stub(cache, 'set').rejects(errorObject);

    let errorEmitted;
    events.on('cache.error', (ctx, err) => {
      errorEmitted = err;
    });

    await cache.start();
    await storeInCache(cache, SEGMENT, ctx, { a: 1 }, 600);
    assert.deepStrictEqual(errorEmitted, errorObject);
  });

  it('emits a cache error event when "ignoreCacheErrors" is true', async () => {
    const cache = createCache();
    sandbox.stub(cache, 'get').rejects(new Error('error'));

    let cacheError = false;
    events.on('cache.error', () => {
      cacheError = true;
    });

    await cache.start();
    try {
      await getFromCache(cache, SEGMENT, ctx, { ignoreCacheErrors: true });
    } catch (error) {
      assert.ok(cacheError);
      return;
    }
    assert.fail('should throw');
  });
});
