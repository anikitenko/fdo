// DevTools fetches external source maps under the inspected frame's connect-src
// policy. Permit only maps for the trusted, bundled renderer scripts present
// before plugin code runs. This grants no HTTP(S) access to plugin UI code.
export function pluginSourceMapConnectSources(document, development = false) {
    if (!development) return [];
    const sources = [];
    for (const script of document.querySelectorAll('script[src]')) {
        try {
            const url = new URL(script.getAttribute('src'), document.baseURI);
            if (url.protocol !== 'static:' || url.hostname !== 'host'
                || url.username || url.password || url.port || url.search || url.hash
                || !/^\/[\w.-]+\.js$/.test(url.pathname)) continue;
            sources.push(url.href + '.map');
        } catch { /* Ignore malformed or non-host script URLs. */ }
    }
    return [...new Set(sources)];
}
