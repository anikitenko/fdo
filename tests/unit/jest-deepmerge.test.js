/** @jest-environment node */
const {createRequire} = require('node:module');
const merge = createRequire(require.resolve('jest-config'))('deepmerge');

test('merges Jest presets and globals without mutating inputs', () => {
    const transform = /\.jsx?$/;
    const symbol = Symbol('config');
    const defaults = {globals: {nested: {preset: true}, list: [{a: 1}], transform}, [symbol]: {a: 1}};
    const overrides = {globals: {nested: {local: true}, list: [{b: 2}]}, [symbol]: {b: 2}};
    const result = merge(defaults, overrides);
    expect(result).toEqual({globals: {nested: {preset: true, local: true}, list: [{a: 1}, {b: 2}], transform}, [symbol]: {a: 1, b: 2}});
    result.globals.list[0].a = 3;
    expect(defaults.globals.list[0].a).toBe(1);
    expect(overrides.globals.list).toEqual([{b: 2}]);
    expect(result.globals.transform).toBe(transform);
    expect(merge.all([defaults, overrides])).toEqual(merge(defaults, overrides));
    expect(merge.all([])).toEqual({});
    expect(() => merge.all({})).toThrow('array');
});

test.each(['target', 'source'])('does not poison returned prototypes through %s keys', side => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":1}');
    const result = side === 'target' ? merge(malicious, {}) : merge({}, malicious);
    expect(result).toEqual({safe: 1});
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.polluted).toBeUndefined();
    for (const key of ['__proto__', 'constructor', 'prototype']) expect(Object.hasOwn(result, key)).toBe(false);
    expect({}.polluted).toBeUndefined();
});

test('protects nested objects and array elements during cloning and all() merging', () => {
    const payload = JSON.parse('{"nested":{"__proto__":{"polluted":true}},"items":[{"__proto__":{"polluted":true}}]}');
    const result = merge.all([payload, {nested: {safe: true}}]);
    expect(result).toEqual({nested: {safe: true}, items: [{}]});
    expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.items[0])).toBe(Object.prototype);
    expect(result.nested.polluted).toBeUndefined();
    expect(result.items[0].polluted).toBeUndefined();
});
