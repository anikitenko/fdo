'use strict';

// Jest's upstream preset installs Babel 7-only syntax plugins even when Babel 8
// skips them. Modern Babel parses all of those standardized features natively.
// Retain the preset API without installing plugins needed only by old Babel 7.
module.exports = function currentNodeSyntax(api) {
    api.assertVersion('^7.29.7 || ^8.0.7');
    return {plugins: []};
};
