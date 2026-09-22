// Public plugin-facing authoring context. Keep this independent of FDO host
// implementation details so every coding provider receives the same contract.
export const PLUGIN_AUTHORING_GUIDE_VERSION = "2026.09.21";

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
    "Register and apply EVERY plugin-local component style, including typography, card contents, icons, controls, grids, tabs, sheets, and responsive/state rules; styling only the shell and a few required test targets is incomplete. For .quick-card, use const quickCardClass = dom.createClassFromStyle(css['quick-card']) and put quickCardClass in the element's class attribute. A literal class='quick-card' does not apply css['quick-card']. Never assume importing the file emits its selectors globally.",
    "Audit selector relationships after generated class names are applied. A selector referring to a literal .dashboard or .panel will not match an element bearing only a generated class. State selectors must target the element that actually carries the state attribute, not an imaginary descendant. Verify responsive, hidden and overlay states through the supported style-map mechanism, not by the mere presence of CSS text.",
    "The CSS style map supports declaration blocks, pseudo selectors, descendant selectors, SCSS-like nested rule blocks, and @keyframes. Feed an imported @keyframes entry through dom.createClassFromStyle(...) so it is emitted; use its named animation in a normal class rule.",
    "When a plugin adds motion, its .css file must include @media (prefers-reduced-motion: reduce) and disable that animation there. Do not replace this CSS rule with matchMedia, inline styles, or a renderOnLoad action option.",
    "This is a limited CSS-to-style-map transform, not a Sass compiler: .scss and .sass files, Sass variables, mixins, functions, interpolation, and Sass module directives are unsupported.",
    "Split substantial styles into cohesive files such as ./styles/base.css, ./styles/layout.css and ./features/text/styles.css. A thin styles.css can compose them using quoted relative @import directives before local rules, or rendering modules may import their own CSS style maps directly. Imports resolve relative to the importing CSS file. Later imports and local declarations override conflicting properties while preserving other properties of the same class, including nested state/media rules. Missing imports and cycles fail compilation. Package, URL, and extensionless imports are unsupported. Keep media queries inside imported files; import qualifiers and Sass directives are unsupported.",
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

DEFAULT VISUAL QUALITY — REQUIRED FOR EVERY UI REQUEST
- Deliver a polished, distinctive, production-quality interface whenever creating or modifying plugin UI, even when the user says nothing about styling. Visual design is part of implementation, not an optional follow-up. Explicit user styling preferences take precedence. For code-only fixes or explanations, preserve the existing UI rather than introducing an unrelated redesign.
- Use an attached screenshot as the visual specification: preserve its hierarchy, proportions, density, palette, component shapes and spacing while adapting to the plugin viewport. Without a reference, choose a coherent visual direction suited to the tool and reuse the existing design language where available.
- Establish a consistent spacing scale, restrained palette, type hierarchy, surface treatments and control sizes. Give labels, descriptions and icons separate alignment and breathing room. Style every visible button and input consistently; Pure CSS is the foundation, not the finished design. Do not leave browser-default buttons beside custom cards or concatenate headings and descriptions into one unspaced line.
- Balance the layout: size inputs and result panes to their content and available width, use an appropriate readable maximum width, and avoid tiny editors stranded in huge empty panels. Keep headings, navigation and primary actions reachable without clipping. Reserve space for persistent docks so they cannot cover content. Adapt columns and spacing at narrow widths.
- Carry the same finish through every category, tool, library, dialog and personal-space view, including empty, loading, success and error states. Closed views must not leak into the page; modal sheets need a backdrop, clear close action, sensible bounds and internal scrolling when needed. Use visible keyboard focus, readable contrast and useful labels. Motion is optional and must respect reduced-motion preferences.
- Before returning code, audit each rendered component against its emitted stylesheet class, then audit layout, overflow, state visibility and navigation across the whole flow. Functional tests passing does not establish visual quality. If screenshots or a browser are available, inspect the rendered result at desktop and narrow widths; otherwise do not claim visual verification. Fix missing style registration instead of adding decorative CSS that never reaches the screen.
- Keep this quality bar during repair and output-limit recovery: share small reusable components and reduce repetition or prose, not the styling, accessibility or functionality of secondary screens.

VERIFIED IFRAME UI RUNTIME CATALOG
${libraries}

VERIFIED UI HELPERS
${helpers}

PLUGIN STYLESHEET CONTRACT
${stylesheetContract}

IMPLEMENTATION DISCIPLINE
- For multi-screen or multi-feature plugins, split code into cohesive workspace modules by responsibility: thin plugin entry/lifecycle, rendering composition, individual screens or tools, action bindings, styles, and focused tests. Use relative imports and explicit exports; keep dependencies acyclic. Do not put all markup and behavior into one giant render file. Keep genuinely small plugins simple and respect explicit user restrictions on file creation.
- Apply modular boundaries to CSS, data fixtures, types and tests as well as TypeScript logic and rendering. Keep feature-specific responsive, state and reduced-motion rules with their owning component styles. A CSS import composes style maps; it does not emit global CSS or remove the need to register and apply each visible class. Keep shared CSS variables on a registered ancestor class so descendants inherit them. Avoid duplicate selectors across unrelated features, import cycles and empty wrapper modules. Smaller complete modules make targeted repairs easier, but do not split every function or rule into a separate inference request.
- Use the smallest clear implementation of each responsibility; there is no minimum line count or file count. Extract a meaningful responsibility when a file grows; do not minify code or create one-line wrapper files just to meet a size target. Plan shared interfaces, selectors, and dependencies before implementation. Generate dependencies before consumers when producing files in stages, then return only changed complete files during repairs while preserving existing module boundaries.
- Renderer helpers may accept the existing DOM instance and registered class names so composed markup uses one rendering context. Browser action functions serialized by defineRenderOnLoadActions must be self-contained: module imports, outer variables, and factory closures are not automatically available in the iframe. Put each complete handler in its owning module and compose handlers/bindings at the entry point; reuse dependencies inside serialized code only through mechanisms explicitly supported by the supplied SDK declarations. Do not invent a shared global or use eval to reconnect modules.
- Prefer small deterministic local fixtures for monitoring, dashboards, and demos. Do not require cloud credentials in generated code or tests unless the user explicitly supplies an approved integration path.
- For a UI action, provide an understandable pending state, a successful result, and an error result. Prefer defineRenderOnLoadActions(...) for an ordinary button click: it binds once through the supported iframe lifecycle. Use type="button" for that action. Every handlers value must be a complete function such as ({document, element}) => { ... }, or a string containing that complete function expression. Never supply a bare statement string such as "window.tools.open();"; the SDK inserts handler strings as expressions and that produces invalid JavaScript. Do not hand-write a form submit listener for a backend UI action. The host reserves data-bound / element.dataset.bound for its own declarative bindings: never read or write either. If a genuinely custom manual listener needs an idempotence marker, use a plugin-specific name such as form.dataset.jsonInspectorBound.
- Current workspace files and supplied SDK declarations are authoritative. Preserve existing conventions unless the task explicitly asks to change them.

FOLDER STRUCTURE AND TYPESCRIPT QUALITY
- Group related files into feature folders when a plugin grows, for example /features/text/, /features/seo/, /ui/, and /tests/. Keep the required root entry files thin. Colocate feature-specific types and tests; put code in /shared/ only when it is genuinely shared by multiple features. Prefer descriptive filenames over a growing catch-all utils.ts. Do not create empty directories or deep folder hierarchies for small plugins.
- Follow existing folder, naming, formatting, module-resolution, and compiler conventions. Use relative imports unless the supplied configuration already supports aliases. Use import type for type-only dependencies, explicit exports for module boundaries, and avoid barrel exports that cause circular imports. Do not add dependencies, change package.json, or rewrite compiler configuration merely to impose a style preference.
- Write TypeScript compatible with strict checking: infer straightforward local values, declare types for exported functions and shared contracts, and handle null/undefined explicitly. Use unknown for untrusted JSON, caught errors, and external inputs, then narrow with runtime checks or type guards. Avoid any, non-null assertions, double casts, @ts-ignore, and assertions used to hide incorrect SDK usage. A type assertion is not runtime validation.
- Model distinct UI and operation states with discriminated unions where useful. Prefer const, readonly data contracts, small pure transformation functions, and explicit success/error results for expected validation failures. Use generics only when they express real reusable type relationships; avoid unnecessary abstractions or classes.
- Await asynchronous operations, handle rejection paths with useful errors, preserve cancellation where supported, and clean up timers/listeners/resources. Do not swallow exceptions or leave floating promises. Keep side effects at lifecycle or action boundaries and deterministic logic independently testable.
- Test public behavior, malformed input, boundary cases, and state transitions with node:test and node:assert/strict. Follow the imports across folders when repairing failures. Check generated code against the supplied SDK declarations and available build/type diagnostics; do not claim type-checking or tests ran unless they actually ran. Bundling alone does not establish that TypeScript is type-correct.
`.trim();
}

export function buildPluginCodingPrompt(prompt = "") {
    return `${buildPluginAuthoringGuide()}\n\nUSER REQUEST\n${String(prompt || "").trim()}`;
}
