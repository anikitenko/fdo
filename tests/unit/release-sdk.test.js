/** @jest-environment node */
const {validateSdkRelease} = require('../../scripts/release/check-sdk.cjs');
const name = '@anikitenko/fdo-sdk';
const pkg = version => ({dependencies: {[name]: version}});
const lock = version => ({packages: {'': pkg(version), [`node_modules/${name}`]: {version}}});

test('release gate requires the latest stable SDK pinned in both manifests', () => {
    expect(validateSdkRelease(pkg('1.8.3'), lock('1.8.3'), '1.8.3')).toBe('1.8.3');
    expect(() => validateSdkRelease(pkg('1.8.3'), lock('1.8.3'), '1.9.0')).toThrow('latest stable SDK');
    expect(() => validateSdkRelease(pkg('^1.8.3'), lock('1.8.3'), '1.8.3')).toThrow('latest stable SDK');
    expect(() => validateSdkRelease(pkg('1.8.3'), lock('1.8.2'), '1.8.3')).toThrow('latest stable SDK');
    expect(() => validateSdkRelease(pkg('1.8.3'), lock('1.8.3'), '2.0.0-beta.1')).toThrow('stable release');
});
