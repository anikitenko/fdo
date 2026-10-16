export function rewritePluginHostHtml(html) {
    if (typeof html !== 'string') return '';
    // HTML minifiers may emit quoted or unquoted attributes. Parse the bundled
    // document so sandboxed frames always load chunks through the static scheme.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const element of parsed.querySelectorAll('[src], [href]')) {
        for (const attribute of ['src', 'href']) {
            const value = element.getAttribute(attribute);
            if (value?.startsWith('./')) element.setAttribute(attribute, 'static://host/' + value.slice(2));
        }
    }
    return '<!doctype html>\n' + parsed.documentElement.outerHTML;
}
