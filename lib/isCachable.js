const directives = require('./directives');

module.exports = (cacheControl, directive, defaultTTL) => {
  return (
    (cacheControl &&
      Object.keys(cacheControl).length > 0 &&
      !cacheControl[directives.NO_STORE] &&
      !cacheControl[directives.PRIVATE] &&
      cacheControl[directive]) ||
    !!defaultTTL
  );
};
