'use strict';

const upstream = require('minimatch-patched');

// dir-compare still calls require('minimatch') directly.
// The upstream function already carries its helpers and defaults API. Add the
// named exports so modern CommonJS consumers use the same patched engine too.
module.exports = upstream.minimatch;
// Keep these assignments explicit for CJS named-export detection in loaders.
module.exports.minimatch = upstream.minimatch;
module.exports.Minimatch = upstream.Minimatch;
module.exports.sep = upstream.sep;
module.exports.GLOBSTAR = upstream.GLOBSTAR;
module.exports.filter = upstream.filter;
module.exports.defaults = upstream.defaults;
module.exports.braceExpand = upstream.braceExpand;
module.exports.match = upstream.match;
module.exports.escape = upstream.escape;
module.exports.unescape = upstream.unescape;
