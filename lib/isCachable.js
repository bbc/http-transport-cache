'use strict';

const { isEmpty } = require('lodash');
const directives = require('./directives');

module.exports = (cacheControl, directive) => {
  return !isEmpty(cacheControl) &&
    !cacheControl[directives.NO_STORE] &&
    !cacheControl[directives.PRIVATE] &&
    (cacheControl[directive]);
};
