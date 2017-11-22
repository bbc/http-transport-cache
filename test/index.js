'use strict';

const assert = require('assert');
const nock = require('nock');
const httpTransport = require('@bbc/http-transport');
const Catbox = require('catbox');
const Memory = require('catbox-memory');
const bluebird = require('bluebird');

const VERSION = require('../package').version;
const httpTransportCache = require('../');

const bodySegment = {
  segment: `http-transport:${VERSION}:stale`,
  id: 'http://www.example.com/'
};

const defaultHeaders = {
  'cache-control': 'max-age=60,stale-if-error=7200'
};

const cachedResponse = {
  body: 'http-transport',
  headers: defaultHeaders,
  elapsedTime: 40,
  url: 'http://www.example.com/',
  statusCode: 200
};

function createCache() {
  const cache = new Catbox.Client(new Memory());
  bluebird.promisifyAll(cache);

  return cache;
}

describe('http-transport-cache', () => {
  it.only('supports max-age and stale-if-error', () => {
    const cache = createCache();

    nock('http://www.example.com')
      .get('/')
      .reply(500, '', defaultHeaders);

    const client = httpTransport
      .createBuilder()
      .use(httpTransportCache.maxAge(cache))
      .use(httpTransportCache.staleIfError(cache))
      .createClient();

    return cache
      .startAsync()
      .then(() => cache.setAsync(bodySegment, cachedResponse, 7200))
      .then(() => {
        return client
          .get('http://www.example.com/')
          .asResponse()
          .then((res) => {
            assert.strictEqual(res.statusCode, 200);
            assert.equal(res.body, 'http-transport');
            return res;
          });
      });
  });
});
