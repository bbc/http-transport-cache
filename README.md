# HTTP Transport Cache

A HTTP spec compliant caching layer for `http-transport`.

## Installation

```
npm install --save http-transport-cache
```

## Usage

Configure response caching based on max-age:

```js
const url = 'http://example.com/';
const HttpTransport = require('http-transport');
const bluebird = require('bluebird');
const Catbox = require('catbox');

const cache = new Catbox.Client(new Memory());
bluebird.promisifyAll(cache);

const client = HttpTransport.createBuilder()
      .use(cache.maxAge(catbox))
      .createClient();

      client.get(url)
        .asBody()
        .then((body) => {
          console.log(body);
        });
```

Configure stale-if-error:

```js
const url = 'http://example.com/';
const HttpTransport = require('http-transport');
const bluebird = require('bluebird');
const Catbox = require('catbox');

const cache = new Catbox.Client(new Memory());
bluebird.promisifyAll(cache);

const client = HttpTransport.createClient()
      .use(cache.staleIfError(catbox))
      .createClient();

      client.get(url)
        .asBody()
        .then((body) => {
          console.log(body);
        });
```

## Features

|Feature|Description|
|----|-----------|
|Warnings|The cached response only contains the simplified `http-transport` request and response so as not to waste cache space.|
|No Cache|If the response specifically includes a `no-cache` directive it will not be cached.|
|Max Age|Responses are stored for the duration of the `max-age` directive and are used before any requests are made.|
|Stale If Error|In order to ensure a resilient service even during errors, http responses can include a `cache-control` directive called `stale-if-error` which means we can use a cached response for that period whilst the service is erroring. To do this a separate response blob is stored for the stale period and on error this response is used alongside the body which is stored for the higher of either `max-age` or `stale-if-error`.|

## Cache Key Structure
 
The cache uses `catbox` to provide a simple pluggable interface, this supports segmenting the cache as well as IDs, thus the following segments are used:

* http-transport:{version}:response - Basic response from a call cached for the duration of the `max-age` value key on just the URL of the response.
* http-transport:{version}:staleResponse - Stale response from a called cached for the `stale-if-error` value keyed on just the URL of the response.

## Test

```
npm test
```

To generate a test coverage report:

```
npm run coverage
```
