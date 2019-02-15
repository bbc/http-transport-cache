'use strict';

const { isEmpty } = require('lodash');

const NO_STORE = 'no-store';
const PRIVATE = 'private';

module.exports = (cacheControl, directive) => {
  if (
    !isEmpty(cacheControl) &&
    !cacheControl[NO_STORE] &&
    !cacheControl[PRIVATE] &&
    (cacheControl[directive])
  ) {
    return true;
  }

  return false;
};
