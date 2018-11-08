'use strict';

const assert = require('chai').assert;
const sandbox = require('sinon').sandbox;

const getRequestId = require('../lib/getRequestId');

describe('Get-request-ID', () => {
  beforeEach(() => {
    sandbox.restore();
  });

  it('returns request key with headers appended', async () => {
    const requestKey = 'GET:host.com?a=1';
    const requestHeaders = { experiment: 'test', status: 200 };
    const getRequestKeyStub = sandbox.stub().returns(requestKey);
    const getHeadersStub = sandbox.stub().returns(requestHeaders);
    const req = {
      getRequestKey: getRequestKeyStub,
      getHeaders: getHeadersStub
    };

    const expectedKey = `${requestKey}${JSON.stringify(requestHeaders)}`;
    const key = getRequestId(req);

    assert.strictEqual(key, expectedKey);
  });
});
