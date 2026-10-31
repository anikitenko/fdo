export const BINDING_FLAGS = ['preventDefault', 'stopPropagation', 'once', 'passive', 'capture', 'required'];
export const BINDING_EVENTS = ['click', 'dblclick', 'input', 'change', 'keydown', 'keyup', 'focus', 'blur'];

export const DEFAULT_CLICK_HANDLER = `({document, element, event}) => {
  if (element) element.setAttribute("aria-pressed", "true");
}`;
export function handlerNameError(name) {
    return typeof name!=='string' || !/^[A-Za-z_$][\w$-]{0,79}$/.test(name) || ['__proto__','constructor','prototype'].includes(name)
        ? 'Use a handler name beginning with a letter, _ or $, followed by letters, numbers, _ , $ or hyphens (up to 80 characters).' : '';
}
