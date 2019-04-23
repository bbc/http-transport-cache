[![NPM downloads](https://img.shields.io/npm/dm/@bbc/http-transport-cache.svg?style=flat)](https://npmjs.org/package/@bbc/http-transport-cache)
[![Build Status](https://api.travis-ci.org/bbc/http-transport-cache.svg)](https://travis-ci.org/bbc/http-transport-cache) 
![npm](https://img.shields.io/npm/v/@bbc/http-transport-cache.svg)
 ![license](https://img.shields.io/badge/license-MIT-blue.svg) 
![github-issues](https://img.shields.io/github/issues/bbc/http-transport-cache.svg)
![stars](https://img.shields.io/github/stars/bbc/http-transport-cache.svg)
![forks](https://img.shields.io/github/forks/bbc/http-transport-cache.svg)

# HTTP Transport Cache

A HTTP spec compliant caching layer for `http-transport`.

## Installation

```
npm install --save http-transport-cache
```

## Usage

Configure response caching based on max-age:

```js
const cache = require('@bbc/http-transport-cache');
const Catbox = require('catbox');
const HttpTransport = require('@bbc/http-transport');

const catbox = new Catbox.Client(new Memory());

const url = 'http://example.com/';

const client = HttpTransport.createBuilder()
      .use(cache.maxAge(catbox))
      .createClient();

      const body = await client.get(url)
        .asBody();

      console.log(body);
```

Configure stale-if-error:

```js
const cache = require('@bbc/http-transport-cache');
const Catbox = require('catbox');
const HttpTransport = require('@bbc/http-transport');

const catbox = new Catbox.Client(new Memory());

const url = 'http://example.com/';

const client = HttpTransport.createClient()
      .use(cache.staleIfError(catbox))
      .createClient();

      const body = await client.get(url)
        .asBody();

      console.log(body);
```

## Features

|Feature|Description|
|----|-----------|
|Warnings|The cached response only contains the simplified `http-transport` request and response so as not to waste cache space.|
|Max Age|Responses are stored for the duration of the `max-age` directive and are used before any requests are made.|
|Stale If Error|In order to ensure a resilient service even during errors, http responses can include a `cache-control` directive called `stale-if-error` which means we can use a cached response for that period whilst the service is erroring. To do this a separate response blob is stored for the stale period and on error this response is used alongside the body which is stored for the higher of either `max-age` or `stale-if-error`.|
|No Store|If `no-store` directive is present in the response, it will not be stored / cached anywhere.|
|Private|If `private` directive is present in the response, it will not be stored by shared cache. The response will only be stored in a private cache intended for a single user.|

## Middleware Options

Both `maxage` and `staleIfError` accept an options object. 

|Property|type|module|Description|
|----|----|----|-----------|
|`ignoreCacheErrors`|boolean|maxage,staleIfError| `cache.maxAge` will return a cache miss when this property is `true`. Setting this property true for `cache.staleIfError` will rethrow the original error (not the cache lookup error). `ignoreCacheErrors` is `false` by default.|
|`timeout`|integer|maxage|Timeouts out a cache lookup after a specified number of ms. By default, no timeout is specified.|

## Cache Key Structure
 
The cache uses `catbox` to provide a simple pluggable interface, this supports segmenting the cache as well as IDs, thus the following segments are used:

* http-transport:{version}:response - Basic response from a call cached for the duration of the `max-age` value key on just the URL of the response.
* http-transport:{version}:staleResponse - Stale response from a called cached for the `stale-if-error` value keyed on just the URL of the response.

Additionally, cache keys can be configured by passing a `varyOn` option. `varyOn` should be an array containing values that you want to vary on. For example, let's say you make requests to the same endpoint but values of some headers vary. By letting `http-transport-cache` know which headers vary, it will first check whether the headers actually exist in the request. If they do then it will construct a unique cache key which contains headers and their values.

Example:

We vary on `accept-language` and `accept`. These headers will exist in the request. We pass in `varyOn` together with other options to configure the plugin.

```js
const opts = {
  timeout: 2000,
  varyOn: [
    'accept-language',
    'accept'
  ]
};
```

On the first request, `accept-language` is `en` and `accept` is `application/json`. The resulting key will be:

* GET:www.example.com/some-cacheable-path:accept-language=en,accept=application/json

On the second request, `accept-language` is `fr` and `accept` is `text/html`. The resulting key will be:

* GET:www.example.com/some-cacheable-path:accept-language=fr,accept=text/html

This way we avoid overwritting data in the store.

## Test

```
npm test
```

To generate a test coverage report:

```
npm run coverage
```
