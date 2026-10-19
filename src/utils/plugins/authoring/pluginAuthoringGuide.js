import {HOST_SERVICES_AUTHORING_SUMMARY} from './hostServicesAuthoringGuide';
// Public plugin-facing authoring context. Keep this independent of FDO host
// implementation details so every coding provider receives the same contract.
export const PLUGIN_AUTHORING_GUIDE_VERSION = "2026.10.19";

export const PLUGIN_STYLE_RENDERING_GUIDANCE = "CSS entries are objects, not strings: never test typeof css.panel === 'string', stringify an entry, or fall back to literal selector names. Share one DOM across child renderers, register styles there and finish with dom.renderHTML(html). In SDK 1.6, collectStylesFrom() starts an isolated retained collector; attach helpers before styling. Legacy collection is shared and drained. DOMStyleMap supports nested rules and numbers without automatic units. Plugin render() must call this composition entry; an unused renderShell does not style the deployed UI. Register palette/custom-property styles on an ancestor of every styled region. For repairs, inspect the actual entry-to-render call chain, replace string-only style lookups, preserve state and handlers, and test the deployed render path and emitted CSS, not only class attributes or stylesheet text.";

export const PLUGIN_STYLE_RENDERING_EXAMPLE = `import {DOM} from '@anikitenko/fdo-sdk';
import css from './styles.css';
function renderBody(dom: DOM): string {
  const panel = dom.createClassFromStyle(css.panel);
  return dom.createElement('section', {class: panel}, 'Content');
}
export function renderView(): string {
  const dom = new DOM();
  const palette = dom.createClassFromStyle(css.palette);
  const html = dom.createElement('main', {class: palette}, renderBody(dom));
  return dom.renderHTML(html);
}
// The plugin's render() returns renderView().
// styles.css defines .palette custom properties and .panel declarations.`;

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
    {name: 'FDOCharts', availability: 'window.FDOCharts in iframe UI runtime', use: 'Frontend only: await window.FDOCharts.create(element, {type:"area",xKey:"day",data:[{day:"Mon",cost:12}],series:[{key:"cost"}]}). Types: line/area/bar/pie. No React imports. controller.update(fullConfig); return cleanup calling controller.dispose(). Use a connected empty element with width; show errors and a data summary.'},
    {name: 'FDOTerminal', availability: 'window.FDOTerminal in iframe UI runtime', use: 'Host-owned xterm.js interactive SSH renderer. Use bytes and consumption callbacks, explicit focus and disposal. No SSH or X11 credentials are exposed.'},
    {
        name: "Ace",
        availability: "window.ace in iframe UI runtime",
        use: "Use for a real code or JSON editing task. Provide a plain text fallback when it cannot initialize.",
    },
]);

export const PLUGIN_UI_HELPERS = Object.freeze([
    "window.createBackendReq(type, data) for a UI event to request a registered backend handler",
    "window.waitForElement(selector, callback, timeout) for rendered UI elements",
    "await window.loadFdoUi() inside frontend setup loads bundled SDK /ui; mount view Elements, return controller cleanup; explicit async onAction must honor signal; omit absent ARIA options",
    "window.executeInjectedScript(scriptContent) for a deliberately injected UI script",
    "window.addGlobalEventListener(eventType, callback) and window.removeGlobalEventListener(eventType, callback)",
    "window.applyClassToSelector(className, selector)",
]);

export const PLUGIN_STYLESHEET_CONTRACT = Object.freeze([
    PLUGIN_STYLE_RENDERING_GUIDANCE,
    "A plugin-local stylesheet must use the .css extension and a relative import such as import css from './styles.css'.",
    "The plugin esbuild virtual loader converts .css source into a JavaScript style map; it does not inject a global stylesheet into the iframe. A .panel selector becomes css.panel (or css[\"panel\"]): the map keys omit the leading dot. Never read css[\".panel\"], because it is undefined.",
    "Import { DOM } from '@anikitenko/fdo-sdk' and construct new DOM() in render(). DOM is not installed on globalThis or window: never invent a global constructor or cast its methods to handwritten signatures. An imported CSS map entry is a style object (Record<string, string>), not a class-name string. Pass that object directly to dom.createClassFromStyle(css.panel); the returned value is the class-name string to pass to renderer helpers and apply to elements. Repeat this for every visible region that has a stylesheet entry, and call dom.renderHTML(...). Passing an undefined map entry produces an unstyled element. createClassFromStyle is an instance method: never call DOM.createClassFromStyle(...).",
    "Register and apply EVERY plugin-local component style, including typography, card contents, icons, controls, grids, tabs, sheets, and responsive/state rules; styling only the shell and a few required test targets is incomplete. For .quick-card, use const quickCardClass = dom.createClassFromStyle(css['quick-card']) and put quickCardClass in the element's class attribute. A literal class='quick-card' does not apply css['quick-card']. Never assume importing the file emits its selectors globally.",
    "Audit selector relationships after generated class names are applied. A selector referring to a literal .dashboard or .panel will not match an element bearing only a generated class. State selectors must target the element that actually carries the state attribute, not an imaginary descendant. Verify responsive, hidden and overlay states through the supported style-map mechanism, not by the mere presence of CSS text.",
    "The CSS style map supports declaration blocks, grouped selectors, pseudo selectors, descendant selectors, CSS nested rule blocks, and @keyframes. Top-level media/supports/container rules are attached to their class entries after imports are composed, so registering css.panel also emits its conditional rules. Pass the complete entry to createClassFromStyle: do not copy only its string-valued declarations, which drops nested rules. Feed an imported @keyframes entry through dom.createClassFromStyle(...) so it is emitted; use its named animation in a normal class rule.",
    "When a plugin adds motion, its .css file must include @media (prefers-reduced-motion: reduce) and disable that animation there. Do not replace this CSS rule with matchMedia, inline styles, or a renderOnLoad action option.",
    "This is a limited CSS-to-style-map transform, not a Sass compiler: .scss and .sass files, Sass variables, mixins, functions, interpolation, and Sass module directives are unsupported.",
    "Split substantial styles into cohesive files such as ./styles/base.css, ./styles/layout.css and ./features/text/styles.css. A thin styles.css can compose them using quoted relative @import directives before local rules, or rendering modules may import their own CSS style maps directly. Imports resolve relative to the importing CSS file. Later imports and local declarations override conflicting properties while preserving other properties of the same class, including nested state/media rules. Missing imports and cycles fail compilation. Package, URL, and extensionless imports are unsupported. Keep media queries inside imported files; import qualifiers and Sass directives are unsupported.",
]);

export function buildPluginAuthoringGuide() {
    const libraries = PLUGIN_RUNTIME_CATALOG.map(item => `${item.name} (${item.availability})`).join('; ');
    return `SHARED FDO PLUGIN AUTHORING GUIDE v${PLUGIN_AUTHORING_GUIDE_VERSION}

WORKING METHOD
- Inspect the user's goal, workspace and installed SDK evidence. Declarations and existing consumers define interfaces; examples show usage. Never invent SDK APIs, signatures or globals. Do not claim all models produce identical results.
- Implement the smallest coherent change. Plan contracts and dependency order; split modules as needed. No minimum line or file count. Respect creation restrictions; preserve unrelated files and passing behavior.
- Validate against source/import checks, compiler and editor diagnostics, tests, and rendered results when available. Treat each failure as new evidence: locate its owner, inspect that owner's dependencies and consumers, repair only the cause, then repeat validation. Preserve assertions and required behavior. A type assertion is not runtime validation. Bundling alone does not establish type correctness.
- Return complete changed files in the requested format. Distinguish verified outcomes from assumptions. Never claim a build, test or visual inspection happened without tool evidence.

${HOST_SERVICES_AUTHORING_SUMMARY}

PLUGIN CONTRACT
- Stay within the plugin workspace and public @anikitenko/fdo-sdk API. Host implementation, settings, credentials and arbitrary host paths are outside the task. Preserve the SDK lifecycle and registration contracts shown in the supplied declarations.
- Keep backend and iframe responsibilities separate. Serialized browser handlers cannot access module closures automatically. Use supported SDK lifecycle bindings; data-bound and element.dataset.bound are reserved for host bindings.
- The UI_MESSAGE bridge passes the content payload directly to the handler. Expected input-validation failures belong in application result data, not transport failure flags.
- Plugin UI renders HTML strings. Do not use React, JSX, className, htmlFor, or react/jsx-runtime. Use documented SDK imports and instance APIs as declared.
- Avoid autofocus/autoFocus in sandboxed UI; use SDK or user-triggered focus.
- Prefer installed SDK DOM helpers/components for all new or changed UI, including nested/dynamic fragments. Use dom.createElement(...) on a DOM instance when no dedicated helper fits. Compose helper-produced strings instead of raw HTML tags; wrapping raw HTML in renderHTML is insufficient. Explain any unavoidable SDK limitation. Preserve input escaping, styles, IDs and bindings; leave unrelated code and user data intact.

DEFAULT VISUAL QUALITY
- The attached screenshot is visual evidence: infer hierarchy, proportions, spacing, typography, palette, shapes and states. Preserve behavior and reference intent across viewports. Do not invent unseen screens or claim visual verification from source alone.
- Keep a coherent, distinctive visual identity. Check navigation, state visibility, keyboard focus, accessible labels, contrast, overflow, narrow layouts and reduced motion. Preserve design during code-only repairs.

VERIFIED IFRAME RUNTIME
${libraries}

PLUGIN CHARTS
${PLUGIN_RUNTIME_CATALOG.find(item => item.name === "FDOCharts").use}

data-fdo-ui-open="id" (type=button): FDO mounts/cleans SDK Dialog/Popover openers. Confirmation requires data-fdo-ui-confirm-selector='[data-fdo-result="visual-result-1"]' + data-fdo-ui-confirm-text: explicit onConfirm writes text to one passive p/pre/span/output; Cancel/Escape preserves it.
Preserve data-fdo-ui-toast-* queue bindings.
Host supplies these libraries; do not add dependencies.

PLUGIN STYLESHEET CONTRACT
- Relative .css imports produce style maps, not global stylesheets. Selector keys omit the leading dot. Register style entries through the documented SDK API and apply the returned class names to their elements.
- ${PLUGIN_STYLE_RENDERING_GUIDANCE}
- Apply every component's styles; registering only the shell leaves its contents unstyled. Preserve supplied state when routing plugin render() through the composition entry.
Canonical composition (use the actual stylesheet keys and existing public interfaces):
~~~typescript
${PLUGIN_STYLE_RENDERING_EXAMPLE}
~~~
- Pure CSS is already injected into plugin iframes. Interactive forms must use a "pure-form pure-form-stacked" wrapper and their main action must use "pure-button pure-button-primary". Keep these foundation classes alongside generated style-map classes; do not import Pure CSS.
- Optional AI identity: the host injects .fdo-ai-mark. Use a decorative span beside readable AI status text; data-active="true" animates pending work. This visual class does not grant AI access or invoke the SDK.
- The loader supports grouped selectors, nested rules, media/state selectors, keyframes and relative CSS imports. Register complete style entries, including nested objects: the loader attaches top-level media/supports/container rules to their class entries. It is not a Sass compiler. Missing imports and cycles fail; package/URL imports and import qualifiers are unsupported. Scope shared styles to registered ancestors and verify every visible style is actually applied.

FOLDER STRUCTURE AND TYPESCRIPT QUALITY
- New scaffolds need /SKILL.md: purpose, modules, SDK conventions and tests. Preserve existing guides.
- Follow current naming, module and dependency conventions. Use import type where appropriate, explicit public contracts, and normal narrowing of unknown inputs. Do not hide errors with any, double casts or suppression comments.
- Node tests lack process.parentPort: test pure modules, or install a bridge before dynamically importing the entry.
- Test public behavior, invalid inputs and state transitions using node:test and node:assert/strict. Keep side effects at lifecycle boundaries, handle async failures, and clean up resources. Do not require cloud credentials or add external integrations unless the task authorizes them.
`;
}

export function buildPluginCodingPrompt(prompt = "") {
    return `${buildPluginAuthoringGuide()}\n\nUSER REQUEST\n${String(prompt || "").trim()}`;
}
