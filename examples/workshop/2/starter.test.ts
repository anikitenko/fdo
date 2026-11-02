import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRepository, loadLatestRelease} from './logic';
import {Render} from './render';

test('accepts owner/repository, rejects URLs and path traversal', () => {
    assert.equal(readRepository(' anikitenko/fdo '), 'anikitenko/fdo');
    for (const value of ['https://github.com/anikitenko/fdo', 'owner/..', '../fdo', '', null]) {
        assert.throws(() => readRepository(value), /owner\/name/);
    }
});
test('constructs the fixed GitHub endpoint and maps a real response shape', async () => {
    const result = await loadLatestRelease('anikitenko/fdo', {
        now: () => new Date('2026-11-02T08:00:00Z'),
        fetcher: async (url, init) => {
            assert.equal(url, 'https://api.github.com/repos/anikitenko/fdo/releases/latest');
            assert.equal(init?.method, 'GET');
            assert.equal(init?.redirect, 'error');
            assert.equal(new Headers(init?.headers).has('Authorization'), false);
            return new Response(JSON.stringify({tag_name: 'v9.8.7', published_at: '2026-11-01T12:00:00Z', html_url: 'https://github.com/anikitenko/fdo/releases/tag/v9.8.7'}));
        },
    });
    assert.equal(result.tag, 'v9.8.7');
    assert.equal(result.checkedAt, '2026-11-02T08:00:00.000Z');
});
test('handles absent releases, rate limits, and malformed data', async () => {
    for (const [status, expected] of [[404, /No public latest release/], [429, /rate-limited/], [503, /HTTP 503/]] as const) {
        await assert.rejects(loadLatestRelease('anikitenko/fdo', {fetcher: async () => new Response('{}', {status})}), expected);
    }
    await assert.rejects(loadLatestRelease('anikitenko/fdo', {fetcher: async () => new Response('{}')}), /unexpected release response/);
});
test('cancels a stalled request and surfaces a timeout', async () => {
    await assert.rejects(loadLatestRelease('anikitenko/fdo', {timeoutMs: 5, fetcher: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
    })}), /timed out/);
});
test('renders accessible controls and escapes the title', () => {
    const html = Render('<Release & monitor>');
    assert.ok(html.includes('&lt;Release &amp; monitor&gt;'));
    assert.ok(!html.includes('<Release & monitor>'));
    assert.match(html, /data-role="repository"/);
    assert.match(html, /data-role="check"/);
    assert.match(html, /aria-live="polite"/);
});
