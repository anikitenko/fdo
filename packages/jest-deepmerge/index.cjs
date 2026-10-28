'use strict';

// jest-config uses deepmerge(target, source) and deepmerge.all(array), both
// with default options. Keep those calls while replacing vulnerable deepmerge.
const merge = require('@fastify/deepmerge')({symbols: true});

function deepmerge(target, source) {
    return merge(target, source);
}

deepmerge.all = function (array) {
    if (!Array.isArray(array)) throw new TypeError('first argument should be an array');
    return array.reduce((result, value) => merge(result, value), {});
};

module.exports = deepmerge;
