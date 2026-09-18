// Public plugin-facing authoring context. Keep this independent of FDO host
// implementation details so every coding provider receives the same contract.
export const PLUGIN_AUTHORING_GUIDE_VERSION = "2026.09.18";

export const PLUGIN_RUNTIME_CATALOG = Object.freeze([
    {
        name: "Pure CSS",
        availability: "iframe UI runtime",
        use: "Use it as the default foundation for interactive plugin screens. Start forms with pure-form pure-form-stacked, use pure-g/pure-u-* for responsive layout, and mark the main action pure-button pure-button-primary. It is already injected: never add an npm import for it. Add plugin-local CSS only for the product-specific visual layer.",
    },
    {
        name: "Font Awesome",
        availability: "iframe UI runtime",
        use: "Use familiar icons as an enhancement. Every icon-only control still needs an accessible name.",
    },
    {
        name: "Split Grid",
        availability: "window.Split in iframe UI runtime",
        use: "Use for an explicitly resizable multi-pane tool, not for a simple two-column layout.",
    },
    {
        name: "highlight.js",
        availability: "window.hljs in iframe UI runtime",
        use: "Use only when showing user-facing code or structured text that benefits from syntax highlighting.",
    },
    {
        name: "Notyf",
        availability: "window.Notyf in iframe UI runtime",
        use: "Use for brief success or failure feedback; keep persistent errors visible in the plugin UI too.",
    },
    {
        name: "Goober",
        availability: "window.goober in iframe UI runtime",
        use: "Use for scoped UI styling when the current render convention can access it. Do not use it in backend/bootstrap code.",
    },
    {
        name: "Ace",
        availability: "window.ace in iframe UI runtime",
        use: "Use for a real code or JSON editing task. Provide a plain text fallback when it cannot initialize.",
    },
]);

export const PLUGIN_UI_HELPERS = Object.freeze([
    "window.createBackendReq(type, data) for a UI event to request a registered backend handler",
    "window.waitForElement(selector, callback, timeout) for rendered UI elements",
    "window.executeInjectedScript(scriptContent) for a deliberately injected UI script",
    "window.addGlobalEventListener(eventType, callback) and window.removeGlobalEventListener(eventType, callback)",
    "window.applyClassToSelector(className, selector)",
]);

export const PLUGIN_STYLESHEET_CONTRACT = Object.freeze([
    "A plugin-local stylesheet must use the .css extension and a relative import such as import css from './styles.css'.",
    "The plugin esbuild virtual loader converts .css source into a JavaScript style map; it does not inject a global stylesheet into the iframe. A .panel selector becomes css.panel (or css[\"panel\"]): the map keys omit the leading dot. Never read css[\".panel\"], because it is undefined.",
    "Create a DOM instance in render(), for example const panelClass = dom.createClassFromStyle(css.panel); then apply panelClass to the panel element. Repeat this for every visible region that has a stylesheet entry, and call dom.renderHTML(...). Passing an undefined map entry produces an unstyled element. createClassFromStyle is an instance method: never call DOM.createClassFromStyle(...).",
    "The CSS style map supports declaration blocks, pseudo selectors, descendant selectors, SCSS-like nested rule blocks, and @keyframes. Feed an imported @keyframes entry through dom.createClassFromStyle(...) so it is emitted; use its named animation in a normal class rule.",
    "When a plugin adds motion, its .css file must include @media (prefers-reduced-motion: reduce) and disable that animation there. Do not replace this CSS rule with matchMedia, inline styles, or a renderOnLoad action option.",
    "This is a limited CSS-to-style-map transform, not a Sass compiler: .scss and .sass files, Sass variables, mixins, functions, interpolation, and Sass module directives are unsupported.",
    "A quoted relative @import may reference another plugin-local CSS file and is merged into the style map. Package, URL, and extensionless imports are unsupported.",
]);

export function buildPluginAuthoringGuide() {
    const libraries = PLUGIN_RUNTIME_CATALOG.map((library) =>
        `- ${library.name}: ${library.availability}. ${library.use}`,
    ).join("\n");
    const helpers = PLUGIN_UI_HELPERS.map((helper) => `- ${helper}`).join("\n");
    const stylesheetContract = PLUGIN_STYLESHEET_CONTRACT.map((rule) => `- ${rule}`).join("\n");
    return `
SHARED FDO PLUGIN AUTHORING GUIDE v${PLUGIN_AUTHORING_GUIDE_VERSION}

This guide is provider-neutral. Use it as a quality foundation, while adapting the functionality and visual identity to the user's plugin. Do not claim all models produce identical results.

PLUGIN CONTRACT
- Stay inside the current plugin workspace. Never inspect, import, or describe product-host source, settings, credentials, privileged host APIs, or arbitrary host paths.
- Use documented public imports from @anikitenko/fdo-sdk. Never import @anikitenko/fdo-sdk/dist/... or host implementation modules.
- Keep backend lifecycle work in init(); register backend handlers with PluginRegistry.registerHandler(handlerId, callback); every handler must return a response value.
- window.createBackendReq("UI_MESSAGE", {handler, content}) unwraps the envelope before it invokes the registered plugin handler. A handler receives the content value itself: for content: {json: input.value}, read data.json (or destructure ({json})); never read data.content.json.
- A normal user-input validation result is not a bridge failure: return a payload such as {valid: false, message: "…"} or {status: "validation-error", message: "…"}. Do not return {ok: false} or {success: false} for expected validation, because those flags surface a host-action error toast.
- Keep window.* calls and DOM interaction in renderOnLoad() UI handlers or UI modules. Do not use browser APIs in init(), constructors, metadata, or backend handlers.
- Keep explicit plugin instantiation at the end of the entry file. Use a verified BlueprintJS v6 icon name for metadata.icon; do not invent plausible names. For data inspection tools, "data-search" is a known valid choice.
- Tests use node:test and node:assert/strict, test plugin-local behavior, and must not need npm install, Jest, Vitest, cloud credentials, shell commands, or host files.

UI AND DESIGN
- The plugin UI runs only in a sandboxed iframe. It may have a distinctive visual identity that suits its purpose; do not force a shared product palette or use every available library.
- Build a clear hierarchy with a visible title, meaningful labels, keyboard-operable controls, accessible names for icon-only controls, and readable empty, loading, and error states.
- Make layouts work at narrow widths. Avoid clipped controls, fixed viewport assumptions, and unscoped global styles.
- Do not use React, JSX, className, htmlFor, or react/jsx-runtime. Plugin workspace source is compiled as TypeScript and the SDK renders HTML strings. In render(), create one instance with const dom = new DOM(); compose the returned strings with dom.createElement(...), apply classes with dom.createClassFromStyle(...), then return dom.renderHTML(view). DOM.createElement(...) is not a static SDK method. Use HTML attributes such as "class" and "for". Do not pass new DOMNested([...]) or new DOMText("text") as children: their constructors do not create markup from arguments.
- For an ordinary interactive form, dashboard, or utility screen, start with injected Pure CSS: a "pure-form pure-form-stacked" form, responsive "pure-g"/"pure-u-*" layout when needed, and "pure-button pure-button-primary" for the main action. It is already available in the iframe; do not import it. Use plugin-local CSS for the plugin's visual identity, compact cards, and behavior that Pure CSS does not provide.
- Other injected libraries are UI-runtime-only and are unavailable to backend/bootstrap/error-fallback code. Choose Font Awesome, Ace, highlight.js, Notyf, Split Grid, or Goober when the task benefits from them.

VERIFIED IFRAME UI RUNTIME CATALOG
${libraries}

VERIFIED UI HELPERS
${helpers}

PLUGIN STYLESHEET CONTRACT
${stylesheetContract}

IMPLEMENTATION DISCIPLINE
- Prefer small deterministic local fixtures for monitoring, dashboards, and demos. Do not require cloud credentials in generated code or tests unless the user explicitly supplies an approved integration path.
- For a UI action, provide an understandable pending state, a successful result, and an error result. Prefer defineRenderOnLoadActions(...) for an ordinary button click: it binds once through the supported iframe lifecycle. Use type="button" for that action. Do not hand-write a form submit listener for a backend UI action. The host reserves data-bound / element.dataset.bound for its own declarative bindings: never read or write either. If a genuinely custom manual listener needs an idempotence marker, use a plugin-specific name such as form.dataset.jsonInspectorBound.
- Current workspace files and supplied SDK declarations are authoritative. Preserve existing conventions unless the task explicitly asks to change them.
`.trim();
}

export function buildPluginCodingPrompt(prompt = "") {
    return `${buildPluginAuthoringGuide()}\n\nUSER REQUEST\n${String(prompt || "").trim()}`;
}
