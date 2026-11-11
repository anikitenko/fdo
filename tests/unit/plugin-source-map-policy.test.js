import {pluginSourceMapConnectSources} from '../../src/components/plugin/utils/pluginSourceMapPolicy';

function documentWithScripts(...sources) {
    const doc = document.implementation.createHTMLDocument('plugin host');
    for (const src of sources) {
        const script = doc.createElement('script');
        script.setAttribute('src', src);
        doc.head.appendChild(script);
    }
    return doc;
}

test('permits exact bundled renderer map URLs in development only', () => {
    const doc = documentWithScripts('static://host/plugin_host.abc123.js', 'static://host/vendor.456.js', 'static://host/plugin_host.abc123.js');
    expect(pluginSourceMapConnectSources(doc, true)).toEqual([
        'static://host/plugin_host.abc123.js.map', 'static://host/vendor.456.js.map',
    ]);
    expect(pluginSourceMapConnectSources(doc)).toEqual([]);
});

test('does not allow external hosts, asset trees, query strings or arbitrary schemes', () => {
    const doc = documentWithScripts('https://example.com/script.js', 'static://assets/script.js',
        'static://host/assets/script.js', 'static://host/script.js?redirect=https://example.com',
        'static://host/script.js#fragment', 'static://user@host/script.js', 'data:text/javascript,void(0)',
        'blob:null/id', 'static://host/style.css');
    expect(pluginSourceMapConnectSources(doc, true)).toEqual([]);
});
