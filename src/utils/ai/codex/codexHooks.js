import {validateMcpTransport} from './codexMcp';
import {CODEX_HOOK_EVENTS} from './codexHookEvents';
export {CODEX_HOOK_EVENTS} from './codexHookEvents';
export const selectedCodexHooks = (hooks, id) => (hooks || []).filter(hook => hook.enabled && hook.assistantIds.includes(id));
export const publicCodexHook = ({environment, ...hook}) => ({...hook, environmentKeys: Object.keys(environment || {})});
export function validateCodexHook(hook, assistants) {
    if (!hook || typeof hook.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(hook.id)) throw new Error('Invalid hook identifier.');
    if (typeof hook.name !== 'string' || !hook.name.trim() || hook.name.length > 64) throw new Error('Use a hook name of 1–64 characters.');
    if (!CODEX_HOOK_EVENTS.includes(hook.event)) throw new Error('Choose a supported Codex hook event.');
    if (!Number.isInteger(hook.timeoutSeconds) || hook.timeoutSeconds < 1 || hook.timeoutSeconds > (hook.event === 'Interrupt' ? 3 : 60)) throw new Error('Use a timeout of 1–60 seconds (1–3 for Interrupt).');
    if (typeof hook.toolPattern !== 'string' || hook.toolPattern.length > 128 || /[\r\n\0]/.test(hook.toolPattern)) throw new Error('Use a tool name pattern of at most 128 characters.');
    const ids = new Set(assistants.filter(a => a.provider === 'codex-cli').map(a => a.id));
    if (typeof hook.enabled !== 'boolean' || !Array.isArray(hook.assistantIds) || hook.assistantIds.some(id => !ids.has(id)) || new Set(hook.assistantIds).size !== hook.assistantIds.length) throw new Error('Assign hooks only to existing Codex coding assistants.');
    validateMcpTransport({...hook, transport:'stdio', authMode:'none', headers:{}});
}
export function hookMatcher(hook) {
    return ['PreToolUse','PostToolUse'].includes(hook.event) && hook.toolPattern
        ? '^' + hook.toolPattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$' : undefined;
}
