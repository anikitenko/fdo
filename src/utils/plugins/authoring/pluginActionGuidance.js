export const isSandboxedFormSubmissionError = text => /blocked form submission|sandboxed[^\n]{0,180}allow-forms|allow-forms[^\n]{0,180}(?:not set|missing|blocked)/i.test(String(text||''));

export const PLUGIN_ACTION_GUIDANCE = `
- UI interactions use defineRenderOnLoadActions({lifecycleKey, strict:true, handlers, bindings}), returned from renderOnLoad(); createRenderOnLoadActionsSource is for source-text interfaces. Commands use type="button", event="click". Guard Enter through conditional SDK keydown handling or use non-submitting groups. No native submits, submit listeners, onclick, or manual user-event listeners, even in setup. Never add allow-forms to the host sandbox.
- Handlers are self-contained serialized functions; use their document/element/window context for DOM mutations and loading/error states. setup initializes state/widgets and returns cleanup. Documented SDK callbacks such as onConfirm and lifecycle/resize cleanup remain supported.
- Backend mutations use PluginRegistry.registerHandler in init(), requested by an SDK handler through window.createBackendReq('UI_MESSAGE',{handler,content}). Preserve permissions, confirmations and result/error handling; bindings grant no permissions. Test actual click dispatch, duplicate-click prevention and cleanup. Migrate changed wiring; preserve unrelated legacy code.`;

export const PLUGIN_ACTION_EXAMPLE = `import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
// The renderer creates a type="button" control with data-action="run",
// an input with data-input="value", and a passive data-output="result" node.
// init() registers the matching 'run' backend handler with PluginRegistry.
// renderOnLoad() returns createViewActions(); do not serialize this factory.
export function createViewActions() {
  return defineRenderOnLoadActions({
    lifecycleKey: 'example.main', strict: true, language: 'typescript',
    handlers: {
      enter: ({event, document}) => {
        if (!(event instanceof KeyboardEvent) || event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        if (!event.repeat) document.querySelector<HTMLButtonElement>('[data-action="run"]')?.click();
      },
      run: async ({document, element, window}) => {
        const input = document.querySelector<HTMLInputElement>('[data-input="value"]');
        const output = document.querySelector<HTMLElement>('[data-output="result"]');
        if (!input || !output) throw new Error('Required action fields are missing.');
        element.setAttribute('aria-busy', 'true');
        element.setAttribute('disabled', '');
        try {
          const response = await window.createBackendReq('UI_MESSAGE', {handler: 'run', content: {value: input.value}});
          const result = response?.result ?? response;
          if (response?.ok === false || response?.success === false || result?.error) throw new Error(String(result?.error || response?.error || 'Action failed.'));
          output.textContent = String(result?.message ?? 'Completed.');
        } catch (error) {
          output.textContent = error instanceof Error ? error.message : String(error);
        } finally {
          element.removeAttribute('disabled');
          element.removeAttribute('aria-busy');
        }
      },
    },
    bindings: [
      {selector: '[data-action="run"]', event: 'click', handler: 'run', preventDefault: true, required: true},
      {selector: '[data-input="value"]', event: 'keydown', handler: 'enter', required: true},
    ],
  });
}`;
