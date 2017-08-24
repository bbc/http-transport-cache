'use strict';

const assert = require('assert');
const httpTransport = require('http-transport');
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const nock = require('nock');
const bluebird = require('bluebird');

const cache = require('../');

const api = nock('http://www.example.com');
const toError = require('http-transport/lib/plugins/toError');

const defaultHeaders = {
  'cache-control': 'max-age=60,stale-if-error=7200'
};
const defaultResponse = 'I am a string!';
const bodySegment = {
  segment: 'http-transport:1.0.0:stale',
  id: 'http://www.example.com/'
};

nock.disableNetConnect();

function createCache() {
  const cache = new Catbox.Client(new Memory());
  bluebird.promisifyAll(cache);

  return cache;
}

function requestWithCache(catbox) {
  return httpTransport
    .createClient()
    .use(cache.staleIfError(catbox))
    .use(toError())
    .get('http://www.example.com/')
    .asBody();
}

describe('Stale-If-Error', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('sets the cache up ready for use', () => {
    const catbox = createCache();

    cache.staleIfError(catbox);

    assert(catbox.isReady());
  });

  it('stores cached values for the stale-if-error value', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, defaultHeaders);

    const expiry = Date.now() + 7200000;

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => {
        const actualExpiry = cached.ttl + cached.stored;
        const differenceInExpires = actualExpiry - expiry;

        assert.deepEqual(cached.item, defaultResponse);
        assert(differenceInExpires < 1000);
      });
  });

  it('does not store if no cache-control', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse);

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => assert(!cached));
  });

  it('does not store if stale-if-error=0', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'stale-if-error=0'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => assert(!cached));
  });

  it('stores even if no max-age', () => {
    const cache = createCache();

    api.get('/').reply(200, defaultResponse, {
      headers: {
        'cache-control': 'stale-if-error=7200'
      }
    });

    return requestWithCache(cache)
      .then(() => cache.getAsync(bodySegment))
      .then((cached) => assert(!cached));
  });

  it('returns cached response if available when error response is returned', () => {
    const cachedResponse = 'http-transport';
    const cache = createCache();

    api.get('/').reply(500, defaultResponse, {});

    return cache.startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 7200))
      .then(() => requestWithCache(cache))
      .then((body) => {
        assert.equal(body, cachedResponse);

        return cache.drop(bodySegment);
      });
  });

  it('returns the original error if nothing in cache', () => {
    const cache = createCache();
    api.get('/').reply(500, defaultResponse, {});

    return requestWithCache(cache)
      .then(() => assert(false, 'Promise should have failed'))
      .catch((err) => {
        assert.equal(err.message, 'Request failed for GET http://www.example.com/');
      });
  });
});
