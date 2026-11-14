export function publishingFixture(patch = {}) {
    return {
        'package.json': JSON.stringify({name: 'release-console', version: '1.0.0', author: 'Platform Team', description: 'A publishing fixture', source: 'index.ts',
            dependencies: {'@anikitenko/fdo-sdk': '1.9.1'}, fdo: {compatibility: {fdo: '*', sdk: '^1.9.1', api: '*'}}, ...patch}),
        'index.ts': `export class ReleaseConsole { declareCapabilities() { return ['storage']; } }`,
        'README.md': '# Release Console',
    };
}
