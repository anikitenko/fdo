/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import {scanTypeScript} from '../../src/utils/plugins/publishing/registryPolicy/typescript-security';

test('installed SDK shared-logic consumer frontend has no document/window false positives', () => {
    const root = path.dirname(require.resolve('@anikitenko/fdo-sdk/package.json'));
    const content = fs.readFileSync(path.join(root,'examples/20-shared-logic-consumer.ts'),'utf8');
    const report = scanTypeScript({bytes:Buffer.alloc(0),files:new Map([['index.ts',content]])});
    expect(report.findings.filter(finding => /Reference to (?:document|window) /.test(finding.message))).toEqual([]);
});
