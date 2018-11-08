'use strict';

const assert = require('chai').assert;
const sandbox = require('sinon').sandbox;

const getRequestId = require('../lib/getRequestId');

describe('Get-request-ID', () => {
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
    const getRequestKeyStub = sandbox.stub().returns(requestKey);
    const getHeadersStub = sandbox.stub().returns(requestHeaders);
    const req = {
      getRequestKey: getRequestKeyStub,
      getHeaders: getHeadersStub
    };

    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200,"Request-ID":"123"}';
    const key = getRequestId(req);

    assert.strictEqual(key, expectedKey);
  });

  it('excludes headers that are specficed in doNotVary', () => {
    const getRequestKeyStub = sandbox.stub().returns(requestKey);
    const getHeadersStub = sandbox.stub().returns(requestHeaders);
    const req = {
      getRequestKey: getRequestKeyStub,
      getHeaders: getHeadersStub
    };

    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200}';
    const key = getRequestId(req, ['Request-ID']);

    assert.strictEqual(key, expectedKey);
  });

  it('excludes headers in doNotVary when case does not match', () => {
    const getRequestKeyStub = sandbox.stub().returns(requestKey);
    const getHeadersStub = sandbox.stub().returns(requestHeaders);
    const req = {
      getRequestKey: getRequestKeyStub,
      getHeaders: getHeadersStub
    };

    const expectedKey = 'GET:host.com?a=1{"experiment":"test","status":200}';
    const key = getRequestId(req, ['request-id']);

    assert.strictEqual(key, expectedKey);
  });
});
