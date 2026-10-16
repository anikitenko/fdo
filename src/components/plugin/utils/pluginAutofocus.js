// Self-contained: serialized into the plugin iframe module. Browser autofocus
// is blocked in cross-origin frames; explicit SDK/user-driven focus is retained.
export function withoutPluginAutofocus(value, React, document, markup = true) {
    if (typeof value === 'string') {
        if (!markup || !/<[a-z][^>]*\bautofocus\b/i.test(value)) return value;
        const template = document.createElement('template');
        template.innerHTML = value;
        template.content.querySelectorAll('[autofocus]').forEach(node=>node.removeAttribute('autofocus'));
        return template.innerHTML;
    }
    if (Array.isArray(value)) return value.map(item=>withoutPluginAutofocus(item,React,document,false));
    if (!React.isValidElement(value)) return value;
    const props = {};
    if (typeof value.type === 'string') {
        if (Object.hasOwn(value.props,'autoFocus')) props.autoFocus = undefined;
        if (Object.hasOwn(value.props,'autofocus')) props.autofocus = undefined;
        const html = value.props.dangerouslySetInnerHTML;
        if (html && typeof html.__html === 'string') {
            const cleaned = withoutPluginAutofocus(html.__html,React,document);
            if (cleaned !== html.__html) props.dangerouslySetInnerHTML = {...html,__html:cleaned};
        }
    }
    if (value.props.children != null) {
        const children = withoutPluginAutofocus(value.props.children,React,document,false);
        if (children !== value.props.children) props.children = children;
    }
    return Object.keys(props).length ? React.cloneElement(value,props) : value;
}
