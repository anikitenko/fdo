import {connectionTemplateFiles} from './connectionTemplates';
import {SPLIT_GRID_LAYOUT, SPLIT_GRID_STYLES} from './splitGridLayout';
import {STARTER_STYLES} from './starterStyles';
import {UTILITY_LOGIC, SERVICE_LOGIC, DASHBOARD_LOGIC} from './starterLogic';
import {dialogTemplateFiles} from './dialogTemplate';

const escapeSource = `export function escapeText(value: unknown): string {
    return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
}
`;
export function starterFiles(name, template) {
    if (['ssh', 'gitSsh'].includes(template)) return connectionTemplateFiles(name, template);
    if (template === 'dialogs') return {...dialogTemplateFiles(name), '/text.ts': escapeSource};
    const utility = template === 'utility', service = template === 'service';
    const dashboard = !utility && !service;
    const resizable = template === 'splitGrid';
    const literal = JSON.stringify(name);
    const handler = utility ? 'inspectJson' : service ? 'loadServices' : 'refreshDashboard';
    const label = utility ? 'Inspect JSON' : service ? 'Load services' : 'Refresh dashboard';
    const logic = utility ? UTILITY_LOGIC : service ? SERVICE_LOGIC : DASHBOARD_LOGIC;
    const main = `import {FDO_SDK, PluginRegistry, defineRenderOnLoadActions${dashboard ? ', QuickActionMixin, SidePanelMixin' : ''}} from '@anikitenko/fdo-sdk';
import {Render} from './render';
${resizable ? "import {initializeSplitLayout} from './split-layout';" : ''}
${utility ? "import {inspectJson} from './logic';" : service ? "import {loadServiceStatus, readEnvironment} from './logic';" : ''}

class StarterPlugin extends ${dashboard ? 'SidePanelMixin(QuickActionMixin(FDO_SDK))' : 'FDO_SDK'} {
    private view = 'overview';
    get metadata() { return {name: ${literal}, version: '1.0.0', author: 'Your team', description: ${JSON.stringify(utility ? 'Inspect JSON locally' : service ? 'Service monitor with a demo adapter' : 'Operations dashboard with demo metrics')}, icon: '${utility ? 'code' : service ? 'cloud' : 'dashboard'}'}; }
    init(): void {
        PluginRegistry.registerHandler('${handler}', ${utility ? "(input: unknown) => {\n            const data = input as {text?: unknown} | null;\n            return inspectJson(typeof data?.text === 'string' ? data.text : '');\n        }" : service ? "async (input: unknown) => {\n            const data = input as {environment?: unknown} | null;\n            return loadServiceStatus(readEnvironment(data?.environment));\n        }" : "() => ({success: true})"});
        ${dashboard ? "PluginRegistry.registerHandler('showOverview', () => { this.view = 'overview'; return {success: true}; });\n        PluginRegistry.registerHandler('showActivity', () => { this.view = 'activity'; return {success: true}; });" : ''}
    }
    ${dashboard ? `defineQuickActions() { return [{name: 'Refresh dashboard', message_type: 'refreshDashboard', icon: 'refresh'}]; }
    defineSidePanel() { return {label: this.metadata.name, icon: 'dashboard', submenu_list: [
        {id: 'overview', name: 'Overview', message_type: 'showOverview'}, {id: 'activity', name: 'Activity', message_type: 'showActivity'},
    ]}; }` : ''}
    render(): string { return Render(${literal}, this.view); }
    renderOnLoad() {
        return defineRenderOnLoadActions({strict: true, language: 'typescript', ${resizable ? 'setup: initializeSplitLayout,' : ''} handlers: {
            run: async ({element}) => {
                const target = document.querySelector<HTMLElement>('[data-role="result"]');
                const button = element instanceof HTMLButtonElement ? element : null;
                if (!target) return;
                if (button) button.disabled = true;
                target.setAttribute('aria-busy', 'true');
                target.textContent = '${utility ? 'Inspecting JSON…' : service ? 'Loading demo services…' : 'Refreshing demo dashboard…'}';
                try {
                    ${utility ? "const text = document.querySelector<HTMLTextAreaElement>('[data-role=\"input\"]')?.value || '';" : service ? "const environment = document.querySelector<HTMLSelectElement>('[data-role=\"environment\"]')?.value || 'staging';" : ''}
                    const response = await window.createBackendReq('UI_MESSAGE', {handler: '${handler}', content: {${utility ? 'text' : service ? 'environment' : ''}}});
                    const result = response?.result ?? response;
                    if (response?.ok === false || response?.success === false || result?.error) throw new Error(String(result?.error || response?.error || 'Request failed.'));
                    ${utility ? "target.textContent = String(result.message || 'Inspection completed.');\n                    target.dataset.state = result.valid ? 'success' : 'error';" : service ? "target.textContent = 'Demo · ' + result.environment + '\\n' + result.services.map((item: {name: string; status: string}) => item.name + ': ' + item.status).join('\\n');\n                    target.dataset.state = 'success';" : "target.textContent = 'Demo dashboard refreshed. Use the sidebar to view activity.';\n                    target.dataset.state = 'success';"}
                    target.style.borderLeft = target.dataset.state === 'error' ? '4px solid #e88484' : '4px solid #68c8a1';
                } catch (error) {
                    target.textContent = error instanceof Error ? error.message : String(error);
                    target.dataset.state = 'error';
                    target.style.borderLeft = '4px solid #e88484';
                } finally {
                    target.setAttribute('aria-busy', 'false');
                    if (button) button.disabled = false;
                }
            },
        }, bindings: [{selector: '[data-role="run"]', event: 'click', handler: 'run', preventDefault: true, required: true}]});
    }
}
new StarterPlugin();
`;
    const render = `import {DOM} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
import {escapeText} from './text';
${dashboard ? "import {dashboardCards} from './logic';" : ''}
export function Render(name: string, view = 'overview'): string {
    const dom = new DOM();
    const classFor = (key: string) => dom.createClassFromStyle(styles[key]);
    const title = dom.createElement('h1', {}, escapeText(name));
    const intro = dom.createElement('p', {class: classFor('muted')}, '${utility ? 'Paste a config or API response. Inspection stays local.' : service ? 'Demo mode · No network requests or credentials. Choose an environment and load sample service status.' : 'Demo metrics · Use Refresh or the plugin sidebar to explore the starter.'}');
    ${utility ? `const input = dom.createElement('label', {for: 'json-source'}, 'JSON input') + dom.createElement('textarea', {id: 'json-source', 'data-role': 'input', class: classFor('editor'), placeholder: '{"service":"api"}'});` : service ? `const input = dom.createElement('label', {for: 'environment'}, 'Environment') + dom.createElement('select', {id: 'environment', 'data-role': 'environment'}, dom.createElement('option', {value: 'staging'}, 'Staging') + dom.createElement('option', {value: 'production'}, 'Production'));` : `const input = dom.createElement('h2', {}, view === 'activity' ? 'Activity' : 'Overview');`}
    const button = dom.createElement('button', {type: 'button', 'data-role': 'run', class: classFor('button')}, '${label}');
    const result = dom.createElement('pre', {'data-role': 'result', role: 'status', 'aria-live': 'polite', class: classFor('result')}, '${utility ? 'Paste JSON, then select Inspect JSON.' : service ? 'Choose an environment, then load demo services.' : 'Ready to refresh. All displayed values are demo data.'}');
    ${dashboard ? `const cards = dashboardCards(view).map(card => dom.createElement('section', {class: classFor('panel')}, dom.createElement('h3', {}, escapeText(card.name)) + dom.createElement('p', {}, escapeText(card.value)))).join('');
    const controls = dom.createElement('section', {class: classFor('panel')${resizable ? ", id: 'split-controls', 'aria-label': 'Dashboard controls'" : ''}}, input + button + result);
    const metrics = dom.createElement('section', {class: classFor('grid')${resizable ? ", id: 'split-metrics', 'aria-label': 'Dashboard metrics'" : ''}}, cards);
    ${resizable ? `const gutter = dom.createElement('div', {class: classFor('gutter'), 'data-role': 'split-gutter', role: 'separator', tabindex: '0', 'aria-label': 'Resize dashboard panels', 'aria-orientation': 'vertical', 'aria-controls': 'split-controls split-metrics', 'aria-valuemin': '20', 'aria-valuemax': '80', 'aria-valuenow': '50'});
    const hint = dom.createElement('p', {'data-role': 'split-hint', class: classFor('muted')}, 'Drag the divider or use the arrow keys to resize.');` : ''}
    const content = ${resizable ? `hint + dom.createElement('section', {class: classFor('split'), 'data-role': 'split-layout'}, controls + gutter + metrics)` : template === 'dashboard' ? 'controls + metrics' : `dom.createElement('section', {class: classFor('${template === 'verDivided' ? 'stack' : 'grid'}')}, controls + metrics)`};` : `const content = dom.createElement('section', {class: classFor('panel')}, input + button + result);`}
    return dom.renderHTML(dom.createElement('main', {class: classFor('shell')}, title + intro + content));
}
`;
    // Utility/service share a render signature with dashboard; the unused view
    // parameter is intentionally omitted so strict noUnusedParameters stays clean.
    const cleanRender = dashboard ? render : render.replace("name: string, view = 'overview'", 'name: string');
    const cleanMain = dashboard ? main : main.replace("    private view = 'overview';\n", '').replace(`Render(${literal}, this.view)`, `Render(${literal})`);
    const tests = `import {test} from 'node:test';
import assert from 'node:assert/strict';
${utility ? "import {inspectJson} from './logic';\ntest('valid JSON includes type count and keys', () => { const result = inspectJson('{\"api\":true,\"count\":2}'); assert.equal(result.valid, true); assert.match(result.message, /object/); assert.match(result.message, /Top-level items: 2/); assert.match(result.message, /api, count/); });\ntest('malformed and empty JSON produce useful errors', () => { assert.equal(inspectJson('{').valid, false); assert.match(inspectJson('').message, /Paste JSON/); });" : service ? "import {loadServiceStatus, readEnvironment} from './logic';\ntest('demo status reflects the selected environment', async () => { const result = await loadServiceStatus('staging'); assert.equal(result.mode, 'demo'); assert.equal(result.services[1].status, 'Maintenance'); assert.equal((await loadServiceStatus('production')).services[1].status, 'Healthy'); });\ntest('unsupported environments are rejected', () => { assert.throws(() => readEnvironment('unknown'), /Choose staging/); });" : "import {dashboardCards} from './logic';\ntest('overview and activity expose different useful data', () => { assert.equal(dashboardCards('overview').length, 3); assert.equal(dashboardCards('activity')[0].name, 'Latest deployment'); });"}
import {Render} from './render';
test('render contains accessible action targets and emits styles', () => {
    const html = Render('<Unsafe & name>');
    assert.match(html, /data-role="run"/); assert.match(html, /aria-live="polite"/);
    assert.ok(html.includes('&lt;Unsafe &amp; name&gt;')); assert.ok(!html.includes('<Unsafe & name>'));
    assert.match(html, /<style/); assert.ok(html.includes('#101820'));
});
`;
    return {'/index.ts': cleanMain, '/render.tsx': cleanRender, '/logic.ts': logic, '/styles.css': STARTER_STYLES + (resizable ? SPLIT_GRID_STYLES : ''), '/text.ts': escapeSource, '/starter.test.ts': tests + (resizable ? `\ntest('resizable workspace exposes a keyboard-accessible separator', () => { const html = Render('Split'); assert.match(html, /role="separator"/); assert.match(html, /aria-valuemin="20"/); assert.match(html, /data-role="split-gutter"/); });\n` : ''), ...(resizable ? {'/split-layout.ts': SPLIT_GRID_LAYOUT} : {})};
}
