import {FDO_SDK, PluginRegistry, defineRenderOnLoadActions, createNetworkCapabilityBundle} from '@anikitenko/fdo-sdk';
import {Render} from './render';
import {loadLatestRelease} from './logic';

class ReleaseMonitor extends FDO_SDK {
    get metadata() { return {name: 'GitHub Release Monitor', version: '1.0.0', author: 'FDO workshops', description: 'Check a public GitHub repository for its latest published release.', icon: 'cloud'}; }
    declareCapabilities() { return createNetworkCapabilityBundle({transports: ['https'], scopeId: 'public-web-secure'}); }
    init(): void {
        PluginRegistry.registerHandler('checkRelease', async (input: unknown) => {
            const data = input as {repository?: unknown} | null;
            try {
                return {kind: 'release', release: await loadLatestRelease(data?.repository)};
            } catch (error) {
                // An upstream HTTP failure is an expected check outcome, not a
                // broken plugin handler. Keep its message in the plugin UI.
                return {kind: 'failed', message: error instanceof Error ? error.message : String(error)};
            }
        });
    }
    render(): string { return Render(this.metadata.name); }
    renderOnLoad() {
        return defineRenderOnLoadActions({strict: true, language: 'typescript', handlers: {
            check: async () => {
                const target = document.querySelector<HTMLElement>('[data-role="result"]');
                const input = document.querySelector<HTMLInputElement>('[data-role="repository"]');
                const button = document.querySelector<HTMLButtonElement>('[data-role="check"]');
                const link = document.querySelector<HTMLAnchorElement>('[data-role="release-link"]');
                if (!target || !input || !button || button.disabled) return;
                button.disabled = true;
                button.textContent = 'Checking GitHub…';
                target.setAttribute('aria-busy', 'true');
                const previous = target.dataset.lastSuccess || '';
                target.textContent = 'Checking GitHub…' + (previous ? '\n\nPrevious successful check (not yet refreshed):\n' + previous : '');
                try {
                    const response = await window.createBackendReq('UI_MESSAGE', {handler: 'checkRelease', content: {repository: input.value}});
                    const payload = response?.result ?? response;
                    if (response?.ok === false || response?.success === false || payload?.error) throw new Error(String(payload?.error || response?.error || 'The check failed.'));
                    if (payload?.kind === 'failed') throw new Error(String(payload.message || 'The check failed.'));
                    const result = payload?.release;
                    if (typeof result?.tag !== 'string' || typeof result?.checkedAt !== 'string') throw new Error('The plugin returned an unexpected result.');
                    const summary = 'GitHub release result\nRepository: ' + result.repository + '\nLatest release: ' + result.tag + '\nPublished: ' + new Date(result.publishedAt).toLocaleString() + '\nChecked: ' + new Date(result.checkedAt).toLocaleString();
                    target.dataset.lastSuccess = summary;
                    target.textContent = summary;
                    target.dataset.state = 'success';
                    if (link) { link.href = result.releaseUrl; link.textContent = 'Open GitHub release'; link.hidden = false; }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    target.textContent = 'Check failed: ' + message + (previous ? '\n\nPrevious successful check (not refreshed):\n' + previous : '');
                    target.dataset.state = 'error';
                } finally {
                    target.setAttribute('aria-busy', 'false');
                    target.style.borderLeft = target.dataset.state === 'error' ? '4px solid #e88484' : '4px solid #68c8a1';
                    button.disabled = false;
                    button.textContent = 'Check latest release';
                }
            },
        }, bindings: [{selector: '[data-role="check"]', event: 'click', handler: 'check', preventDefault: true, required: true}]});
    }
}
new ReleaseMonitor();
