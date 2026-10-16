// These source templates run in the virtual plugin workspace; workspace typecheck tests validate them.
import {STARTER_STYLES} from './starterStyles';

export function dialogTemplateFiles(name) {
    return {
        '/index.ts': /* language=TEXT */ `import {FDO_SDK, PluginRegistry, defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
import {Render} from './render';
import {validateSettings, type Settings} from './logic';

class DialogPlugin extends FDO_SDK {
    private settings: Settings = {label: 'Operations workspace', environment: 'staging'};
    get metadata() { return {name: ${JSON.stringify(name)}, version: '1.0.0', author: 'Your team', description: 'Styled settings dialog with local validation', icon: 'application'}; }
    init(): void {
        PluginRegistry.registerHandler('saveSettings', (input: unknown) => {
            try {
                this.settings = validateSettings(input);
                return {valid: true, ...this.settings};
            } catch (error) {
                return {valid: false, message: error instanceof Error ? error.message : String(error)};
            }
        });
    }
    render(): string { return Render(${JSON.stringify(name)}, this.settings); }
    renderOnLoad() {
        return defineRenderOnLoadActions({strict: true, language: 'typescript', handlers: {
            open: () => {
                const dialog = document.querySelector<HTMLDialogElement>('[data-role="settings-dialog"]');
                const error = document.querySelector<HTMLElement>('[data-role="dialog-error"]');
                document.querySelector<HTMLFormElement>('[data-role="settings-form"]')?.reset();
                if (error) { error.hidden = true; error.textContent = ''; }
                if (dialog && !dialog.open) dialog.showModal();
            },
            close: () => { document.querySelector<HTMLDialogElement>('[data-role="settings-dialog"]')?.close(); },
            cancel: ({event}) => {
                if (event instanceof Event && document.querySelector('[data-role="settings-dialog"]')?.getAttribute('aria-busy') === 'true') event.preventDefault();
            },
            enter: ({event}) => {
                // Sandboxed plugin iframes block native form submission. Use
                // explicit actions for both mouse and keyboard activation.
                if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.isComposing && event.target instanceof HTMLInputElement) {
                    event.preventDefault();
                    document.querySelector<HTMLButtonElement>('[data-role="save-dialog"]')?.click();
                }
            },
            save: async () => {
                const dialog = document.querySelector<HTMLDialogElement>('[data-role="settings-dialog"]');
                const form = document.querySelector<HTMLFormElement>('[data-role="settings-form"]');
                const error = document.querySelector<HTMLElement>('[data-role="dialog-error"]');
                const summary = document.querySelector<HTMLElement>('[data-role="summary"]');
                const status = document.querySelector<HTMLElement>('[data-role="result"]');
                if (!dialog || !form || !error || !summary || !status || dialog.getAttribute('aria-busy') === 'true') return;
                if (!form.reportValidity()) return;
                const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'));
                const label = form.querySelector<HTMLInputElement>('[name="label"]')?.value || '';
                const environment = form.querySelector<HTMLSelectElement>('[name="environment"]')?.value || '';
                error.hidden = true;
                dialog.setAttribute('aria-busy', 'true');
                controls.forEach(control => { control.disabled = true; });
                status.textContent = 'Saving local settings…';
                try {
                    const response = await window.createBackendReq('UI_MESSAGE', {handler: 'saveSettings', content: {label, environment}});
                    const result = response?.result ?? response;
                    if (response?.ok === false || response?.success === false || result?.error) throw new Error(String(result?.error || response?.error || 'Could not save settings.'));
                    if (result?.valid === false) throw new Error(String(result.message || 'Check your settings.'));
                    const labelInput = form.querySelector<HTMLInputElement>('[name="label"]');
                    const environmentInput = form.querySelector<HTMLSelectElement>('[name="environment"]');
                    if (labelInput) labelInput.defaultValue = result.label;
                    if (environmentInput) Array.from(environmentInput.options).forEach(option => { option.defaultSelected = option.value === result.environment; });
                    summary.textContent = result.label + ' · ' + result.environment;
                    status.textContent = 'Settings saved for this plugin session.';
                    status.dataset.state = 'success';
                    dialog.close();
                } catch (failure) {
                    error.textContent = failure instanceof Error ? failure.message : String(failure);
                    error.hidden = false;
                    status.textContent = 'Settings were not saved. Review the dialog and try again.';
                    status.dataset.state = 'error';
                } finally {
                    dialog.setAttribute('aria-busy', 'false');
                    controls.forEach(control => { control.disabled = false; });
                }
            },
        }, bindings: [
            {selector: '[data-role="open-dialog"]', event: 'click', handler: 'open', required: true},
            {selector: '[data-role="close-dialog"]', event: 'click', handler: 'close', required: true},
            {selector: '[data-role="settings-dialog"]', event: 'cancel', handler: 'cancel', required: true},
            {selector: '[data-role="save-dialog"]', event: 'click', handler: 'save', required: true},
            {selector: '[data-role="settings-form"]', event: 'keydown', handler: 'enter', required: true},
        ]});
    }
}
new DialogPlugin();
`,
        '/logic.ts': `export type Settings = {label: string; environment: 'staging' | 'production'};
export function validateSettings(input: unknown): Settings {
    const value = input as {label?: unknown; environment?: unknown} | null;
    const label = typeof value?.label === 'string' ? value.label.trim() : '';
    if (!label || label.length > 60) throw new Error('Enter a workspace label of 1–60 characters.');
    if (value?.environment !== 'staging' && value?.environment !== 'production') throw new Error('Choose staging or production.');
    return {label, environment: value.environment};
}
`,
        '/render.tsx': `import {DOM} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
import {escapeText} from './text';
import type {Settings} from './logic';
export function Render(name: string, settings: Settings = {label: 'Operations workspace', environment: 'staging'}): string {
    const dom = new DOM();
    const cls = (key: string) => dom.createClassFromStyle(styles[key]);
    const title = dom.createElement('h1', {}, escapeText(name));
    const intro = dom.createElement('p', {class: cls('muted')}, 'Local settings demo · No network requests or credentials.');
    const badge = dom.createElement('span', {class: cls('badge')}, 'SESSION SETTINGS');
    const summary = dom.createElement('h2', {'data-role': 'summary'}, escapeText(settings.label + ' · ' + settings.environment));
    const open = dom.createElement('button', {type: 'button', class: cls('button'), 'data-role': 'open-dialog', 'aria-haspopup': 'dialog', 'aria-controls': 'workspace-dialog'}, 'Configure workspace');
    const status = dom.createElement('p', {class: cls('feedback'), 'data-role': 'result', role: 'status', 'aria-live': 'polite'}, 'Changes are kept for this running plugin session.');
    const hero = dom.createElement('section', {class: cls('hero')}, badge + summary + intro + open + status);
    const fields = dom.createElement('div', {class: cls('fields')},
        dom.createElement('label', {for: 'workspace-label'}, 'Workspace label') +
        dom.createElement('input', {id: 'workspace-label', name: 'label', class: cls('field'), value: settings.label, required: '', maxlength: '60', autofocus: ''}) +
        dom.createElement('label', {for: 'workspace-environment'}, 'Environment') +
        dom.createElement('select', {id: 'workspace-environment', name: 'environment', class: cls('field')},
            ['staging', 'production'].map(value => dom.createElement('option', {value, ...(settings.environment === value ? {selected: ''} : {})}, value === 'staging' ? 'Staging' : 'Production')).join('')));
    const error = dom.createElement('p', {'data-role': 'dialog-error', role: 'alert', hidden: '', class: cls('error')});
    const footer = dom.createElement('footer', {class: cls('dialogActions')},
        dom.createElement('button', {type: 'button', class: cls('secondary'), 'data-role': 'close-dialog'}, 'Cancel') +
        dom.createElement('button', {type: 'button', 'data-role': 'save-dialog', class: cls('button')}, 'Save settings'));
    const form = dom.createElement('form', {'data-role': 'settings-form'},
        dom.createElement('header', {class: cls('dialogHeader')}, dom.createElement('h2', {id: 'settings-title'}, 'Workspace settings') + dom.createElement('p', {id: 'settings-description'}, 'Choose a label and environment. This does not deploy or contact a service.')) + fields + error + footer);
    const dialog = dom.createElement('dialog', {id: 'workspace-dialog', 'data-role': 'settings-dialog', 'aria-labelledby': 'settings-title', 'aria-describedby': 'settings-description', class: cls('dialog')}, form);
    return dom.renderHTML(dom.createElement('main', {class: cls('shell')}, title + hero + dialog));
}
`,
        '/styles.css': STARTER_STYLES + `
.hero { padding: clamp(20px, 5vw, 48px); border: 1px solid #486589; border-radius: 20px; background: linear-gradient(135deg, #203b60, #172636 75%); box-shadow: 0 18px 48px #00000040; }
.badge { display: inline-block; border: 1px solid #759bc4; border-radius: 999px; padding: 6px 12px; color: #c3ddff; font-size: 11px; letter-spacing: 0.12em; }
.button:hover { background: #3075bd; }
.button:focus-visible, .secondary:focus-visible, .field:focus-visible { outline: 3px solid #a9d0ff; outline-offset: 3px; }
.button:disabled, .secondary:disabled { opacity: 0.55; cursor: wait; }
.feedback { padding: 12px 16px; border-left: 3px solid #759bc4; line-height: 1.5; }
.feedback[data-state="success"] { border-color: #68c8a1; color: #a4eacb; }
.feedback[data-state="error"] { border-color: #e88484; color: #ffb8b8; }
.dialog { color: #e6edf3; background: #182637; border: 1px solid #759bc4; border-radius: 18px; padding: 0; width: min(560px, calc(100vw - 32px)); max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box; box-shadow: 0 24px 80px #00000080; }
.dialog::backdrop { background: #030a16b8; backdrop-filter: blur(4px); }
.dialogHeader { padding: 24px; background: linear-gradient(135deg, #26456c, #1a2d44); border-bottom: 1px solid #486589; }
.dialogHeader h2 { margin: 0 0 8px; }
.dialogHeader p { margin: 0; line-height: 1.5; color: #c4d4e6; }
.fields { display: grid; gap: 12px; padding: 24px; }
.field { width: 100%; min-width: 0; box-sizing: border-box; padding: 12px; border: 1px solid #759bc4; border-radius: 8px; color: #e6edf3; background: #101820; font: inherit; }
.dialogActions { display: flex; justify-content: flex-end; gap: 12px; padding: 20px 24px; border-top: 1px solid #486589; }
.dialogActions button { margin-top: 0; }
.secondary { padding: 10px 18px; border: 1px solid #759bc4; border-radius: 8px; background: transparent; color: #e6edf3; cursor: pointer; }
.secondary:hover { background: #2e4662; }
.error { margin: 0 24px 20px; padding: 12px; border-left: 3px solid #e88484; color: #ffb8b8; background: #421e2a; }
@media (max-width: 480px) {
    .shell { padding: 12px; }
    .hero { border-radius: 12px; }
    .dialogHeader, .fields { padding: 16px; }
    .dialogActions { flex-direction: column; padding: 16px; }
    .dialogActions button { width: 100%; }
}
`,
        '/starter.test.ts': `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings} from './logic';
import {Render} from './render';
test('settings are trimmed and invalid input is rejected', () => {
    assert.deepEqual(validateSettings({label: ' Team ', environment: 'production'}), {label: 'Team', environment: 'production'});
    for (const input of [null, {label: ' ', environment: 'staging'}, {label: 'Team', environment: 'other'}, {label: 'x'.repeat(61), environment: 'staging'}]) assert.throws(() => validateSettings(input));
});
test('dialog has labelled fields and emits complex stylesheet rules', () => {
    const html = Render('<Unsafe & name>', {label: 'Team <A>', environment: 'production'});
    assert.match(html, /<dialog/); assert.match(html, /aria-labelledby="settings-title"/);
    assert.match(html, /data-role="settings-form"/); assert.match(html, /for="workspace-label"/);
    assert.match(html, /&lt;Unsafe &amp; name&gt;/); assert.match(html, /Team &lt;A&gt;/);
    for (const rule of ['<style', 'linear-gradient', '::backdrop', ':focus-visible', '@media', 'max-width: 480px']) assert.ok(html.includes(rule), 'Missing emitted CSS: ' + rule);
});
`,
    };
}
