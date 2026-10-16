import {rewritePluginHostHtml} from '../../src/components/plugin/utils/pluginHostHtml';

test.each(['./runtime.js', '"./runtime.js"', "'./runtime.js'"])(
    'rewrites minified and quoted script attributes: %s', source => {
        const html = rewritePluginHostHtml(`<html lang="en"><head><script src=${source}></script><link href=./styles.css rel=stylesheet></head><body><main>Plugin</main></body></html>`);
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        expect(parsed.querySelector('script').getAttribute('src')).toBe('static://host/runtime.js');
        expect(parsed.querySelector('link').getAttribute('href')).toBe('static://host/styles.css');
        expect(parsed.querySelector('main').textContent).toBe('Plugin');
    });
test('preserves absolute asset URLs and handles absent HTML', () => {
    expect(rewritePluginHostHtml(null)).toBe('');
    const html = rewritePluginHostHtml(/* language=TEXT */ '<script src="static://assets/sdk.js"></script><link href="https://example.com/style.css">');
    expect(html).toContain('src="static://assets/sdk.js"');
    expect(html).toContain('href="https://example.com/style.css"');
});
