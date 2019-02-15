'use strict';

const { isEmpty } = require('lodash');

const MAX_AGE = 'max-age';
const STALE_IF_ERROR = 'stale-if-error';
const NO_STORE = 'no-store';
const PRIVATE = 'private';

module.exports = (cacheControl) => {
  if (
    !isEmpty(cacheControl) &&
    !cacheControl[NO_STORE] &&
    !cacheControl[PRIVATE] &&
    (cacheControl[MAX_AGE] || cacheControl[STALE_IF_ERROR])
  ) {
    return true;
  }

  return false;
};
