export const PLUGIN_ACTION_GUIDANCE = `
- New/changed clicks, input/change handlers and UI mutations use defineRenderOnLoadActions({lifecycleKey, strict:true, handlers, bindings}). Return its descriptor from renderOnLoad(); use createRenderOnLoadActionsSource only for an explicit source-text interface. Wire commands as type="button", event="click". Native form submission, submit listeners, onclick attributes/assignments and manual user-event listeners are unsupported, including inside setup.
- Handlers are self-contained serialized functions; use their document/element/window context for DOM mutations and loading/error states. setup initializes state/widgets and returns cleanup. Documented SDK callbacks such as onConfirm and lifecycle/resize cleanup remain supported.
- Backend mutations use PluginRegistry.registerHandler in init(), requested by an SDK handler through window.createBackendReq('UI_MESSAGE',{handler,content}). Preserve permissions, confirmations and result/error handling; bindings grant no permissions. Test actual click dispatch, duplicate-click prevention and cleanup. Preserve unrelated legacy wiring; migrate wiring you change, not the entire workspace.`;

export const PLUGIN_ACTION_EXAMPLE = `import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
// The renderer creates a type="button" control with data-action="run",
// an input with data-input="value", and a passive data-output="result" node.
// init() registers the matching 'run' backend handler with PluginRegistry.
// renderOnLoad() returns createViewActions(); do not serialize this factory.
export function createViewActions() {
  return defineRenderOnLoadActions({
    lifecycleKey: 'example.main', strict: true, language: 'typescript',
    handlers: {
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
    bindings: [{selector: '[data-action="run"]', event: 'click', handler: 'run', preventDefault: true, required: true}],
  });
}`;
