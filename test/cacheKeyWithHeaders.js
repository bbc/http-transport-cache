'use strict';

const assert = require('chai').assert;
const sandbox = require('sinon').sandbox;

const cacheKeyWithHeaders = require('../lib/cacheKeyWithHeaders');

describe('Cache-key-with-headers', () => {
  const requestKey = 'GET:host.com?a=1';
  const requestHeaders = {
    experiment: 'test',
    status: 200,
    'Request-ID': '123'
  };

  beforeEach(() => {
    sandbox.restore();
  });

  it('returns request key with headers appended', async () => {
    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200,"Request-ID":"123"}';
    const key = cacheKeyWithHeaders(requestKey, requestHeaders);

    assert.strictEqual(key, expectedKey);
  });

  it('returns request key with no headers appended if there are no headers', async () => {
    const expectedKey = 'GET:host.com?a=1';
    const key = cacheKeyWithHeaders(requestKey);

    assert.strictEqual(key, expectedKey);
  });

  it('excludes headers that are specficed in doNotVary', () => {
    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200}';
    const key = cacheKeyWithHeaders(requestKey, requestHeaders, ['Request-ID']);

    assert.strictEqual(key, expectedKey);
  });

  it('excludes headers in doNotVary when case does not match', () => {
    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200}';
    const key = cacheKeyWithHeaders(requestKey, requestHeaders, ['request-id']);

    assert.strictEqual(key, expectedKey);
  });
});
