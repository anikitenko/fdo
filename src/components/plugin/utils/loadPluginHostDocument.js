import {rewritePluginHostHtml} from './pluginHostHtml';

// All plugin frames in this renderer use the same trusted build artifact.
// Share in-flight work only. The HTML points at hashed JS chunks which can
// change after a build/update; retaining successful HTML makes every reload
// request the same deleted chunks and prevents the iframe handshake forever.
const documents = new WeakMap();
/** @param {(url: string, options: RequestInit) => Promise<{ok?: boolean, status?: number, text: () => (Promise<string> | string)}>} [fetcher] */
export function loadPluginHostDocument(fetcher = window.fetch) {
    if (!documents.has(fetcher)) {
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                reject(new Error('Plugin host document loading timed out. Retry loading the plugin UI.'));
                controller.abort();
            }, 10000);
        });
        const request = Promise.resolve().then(() => fetcher('static://host/plugin_host.html', {signal: controller.signal, cache:'no-store'}))
            .then(response => {
                if (response.ok === false) throw new Error(`Plugin host document request failed (${response.status}).`);
                return response.text();
            })
            .then(rewritePluginHostHtml);
        const loading = Promise.race([request, deadline])
            .finally(() => {
                clearTimeout(timer);
                if (documents.get(fetcher) === loading) documents.delete(fetcher);
            });
        documents.set(fetcher, loading);
    }
    return documents.get(fetcher);
}
