[![NPM downloads](https://img.shields.io/npm/dm/@bbc/http-transport-cache.svg?style=flat)](https://npmjs.org/package/@bbc/http-transport-cache)
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
const Catbox = require('@hapi/catbox');
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

Listening to Events:
``` JS
const { events, maxAge } = require('@bbc/http-transport-cache');

const stats = require('@ibl/stats');
const Catbox = require('catbox');
const HttpTransport = require('@bbc/http-transport');

const catbox = new Catbox.Client(new Memory());

const url = 'http://example.com/';

const client = HttpTransport.createBuilder()
  .use(cache.maxAge(catbox, {
    name: `theservice`,
  }))
  .createClient();

events.on(`cache.theservice.read_time`, (ctx) => {
  stats.timing(`timingstat.read_time`, ctx.duration);
});
```


## Features

|Feature|Description|
|----|-----------|
|Warnings|The cached response only contains the simplified `http-transport` request and response so as not to waste cache space.|
|Max Age|Responses are stored for the duration of the `max-age` directive and are used before any requests are made.|
|Stale If Error|In order to ensure a resilient service even during errors, http responses can include a `cache-control` directive called `stale-if-error` which means we can use a cached response for that period whilst the service is erroring. To do this a separate response blob is stored for the stale period and on error this response is used alongside the body which is stored for the higher of either `max-age` or `stale-if-error`.|
|No Store|If `no-store` directive is present in the response, it will not be stored / cached anywhere.|
|Private|If `private` directive is present in the response, it will not be stored by shared cache. The response will only be stored in a private cache intended for a single user.|


### Events
- hit
- miss
- error 
- timeout 
- stale
- read_time
- write_time
- connection_error

## Middleware Options

Both `maxage` and `staleIfError` accept an options object. 

|Property|type|module|Description|
|----|----|----|-----------|
|`ignoreCacheErrors`|boolean|maxAge,staleIfError| `cache.maxAge` will return a cache miss when this property is `true`. Setting this property true for `cache.staleIfError` will rethrow the original error (not the cache lookup error). `ignoreCacheErrors` is `false` by default.|
|`timeout`|integer|maxAge|Timeouts a cache lookup after a specified number of ms. By default, no timeout is specified.|
|`connectionTimeout`|integer|maxAge,staleIfError|Timeouts the attempt to connect to a cache after a specified number of ms. By default, no timeout is specified.|
|`connectionCircuitBreakerOptions`|object|maxAge,staleIfError| When present an instance of [Levee](https://github.com/krakenjs/levee) will be created with these configuration options to use on connection to cache.|
|`includeCacheStatusInCtx`|boolean|maxAge,staleIfError| When present, a `cacheStatus` array - recording all cache events, will be set in `context` for use by other plugins. `includeCacheStatusInCtx` is `false` by default.|

## Cache Key Structure
 
The cache uses `catbox` to provide a simple pluggable interface, this supports segmenting the cache as well as IDs, thus the following segments are used:

* http-transport:{version}:response - Basic response from a call cached for the duration of the `max-age` value key on just the URL of the response.
* http-transport:{version}:staleResponse - Stale response from a called cached for the `stale-if-error` value keyed on just the URL of the response.

Additionally, cache keys can be configured by passing a `varyOn` option. `varyOn` should contain an array of request header names which the cache should additionally vary on; for some use-cases, requests made to the same endpoint but with differing values for certain headers elicit different responses - and therefore cannot share the same cached response e.g.`accept-language`. By letting `http-transport-cache` know which headers to vary on, a unique cache key will be constructed which also contains said headers and their values.

Example:

We make a `GET` request to the following URL: `www.example.com/some-cacheable-path`.

We vary on `accept-language` and `accept`. These headers will exist in the request. We pass in `varyOn` (an array of request headers we vary on) together with other options to configure the plugin.

```js
const opts = {
  timeout: 2000,
  varyOn: [
    'accept-language',
    'accept'
  ]
};
```

On the first request, the value of `accept-language` is `en` and `accept` is `application/json`. The resulting key will be:

* GET:www.example.com/some-cacheable-path:accept-language=en,accept=application/json

On the second request, the value of `accept-language` is `fr` and `accept` is `text/html`. The resulting key will be:

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
