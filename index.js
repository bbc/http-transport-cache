'use strict';

const maxAge = require('./lib/maxAge');
const staleIfError = require('./lib/staleIfError');

module.exports = {
  maxAge,
  staleIfError
};
