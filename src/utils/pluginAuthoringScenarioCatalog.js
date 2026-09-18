export const PLUGIN_AUTHORING_SCENARIOS = Object.freeze([
    {
        id: "json-inspector",
        title: "JSON Inspector",
        handler: "inspectJson",
        seed: "json-inspector-v1",
        designBriefs: [
            "a compact developer console with high information density",
            "a calm data-review workspace with generous readable spacing",
            "a focused utility panel with a clear input-to-result flow",
        ],
        prompt: `Create a compact JSON Inspector plugin using only local deterministic data. It accepts pasted JSON, validates it through a backend handler named inspectJson, and displays either a concise error or a summary with the value type, top-level item count, and top-level keys when applicable. The UI bridge calls window.createBackendReq("UI_MESSAGE", {handler: "inspectJson", content: {json: input.value}}). That handler receives the content object directly, so implement it as PluginRegistry.registerHandler("inspectJson", ({json}) => ...) or read data.json. Do not read data.content.json or request.content.json. Return its inspection payload. Include a clearly labelled Inspect JSON action, pending feedback, an empty state, and a visible result area. Use data-role="json-input", data-role="inspect-json", and data-role="result". Set the result data-state to "success" for valid JSON. Set it to "error" for malformed JSON. Import and use defineRenderOnLoadActions(...) with a binding for selector [data-role="inspect-json"] and event "click". Its button must use type="button". Do not write a manual form.addEventListener("submit", ...) listener. The host reserves data-bound / element.dataset.bound: never read or write it. Set metadata.icon to exactly "data-search", a verified BlueprintJS v6 icon name. Use the injected Pure CSS foundation before custom CSS: a pure-form pure-form-stacked wrapper, pure-g/pure-u-* layout where useful, and an Inspect action with exactly pure-button pure-button-primary. Pure CSS is already in the iframe; do not import it. For expected invalid JSON, the backend handler must return a normal validation payload such as {valid: false, message: "Malformed JSON."}; never return {ok: false} or {success: false}, because those are transport-failure flags. Use exactly /index.ts, /render.tsx, /styles.css, and /render.test.ts; do not create helper modules. Import /styles.css as a style map. In render(), create one DOM instance and call dom.createClassFromStyle(...) plus dom.renderHTML(...); createClassFromStyle is not a static DOM method. Do not use React or JSX: use the same dom instance for dom.createElement(...), dom.createClassFromStyle(...), and dom.renderHTML(...). DOM.createElement(...) is invalid. Compose the DOM helper's returned HTML strings directly; do not use new DOMNested([...]) or new DOMText("text") as children. Use HTML "class" attributes, then pass the composed HTML string to dom.renderHTML(...). Style-map keys omit the CSS dot: use css.panel or css["panel"], never css[".panel"]. The visual result must be a polished compact tool, not browser defaults: a centered .panel card with a non-transparent surface, border, rounded corners, shadow, 1rem-or-more padding, and max-width; a full-width .input editor at least 12rem tall; a vertical input-to-action flow with spacing; a high-contrast .action button; and a distinct .result surface for empty, success, and error states. Apply the panel, input, action, and result style-map entries in render(). Include one nested selector and a small @keyframes motion detail. Acceptance requirement: /styles.css must literally include @media (prefers-reduced-motion: reduce) and set animation: none for the animated class. Implement reduced motion in CSS, never with matchMedia, inline styles, or an onLoad field in defineRenderOnLoadActions. Add node:test and node:assert/strict tests for the title, the input/action targets, and the result area. Return only complete workspace file sections: no prose or long comments. Keep all four source files together below 190 lines. Do not use shell commands, network access, cloud credentials, host files, or external plugin dependencies. Apply complete plugin workspace files.`,
        followUp: "Add a clearly labelled Reset action that clears the JSON input and result display. Preserve the Inspect JSON behavior and existing tests; update tests only when needed.",
    },
]);

function stableIndex(seed, size) {
    let hash = 2166136261;
    for (const character of String(seed || "")) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % size;
}

export function selectPluginAuthoringScenario(seed = "json-inspector-v1") {
    const scenario = PLUGIN_AUTHORING_SCENARIOS[stableIndex(seed, PLUGIN_AUTHORING_SCENARIOS.length)];
    const designBrief = scenario.designBriefs[stableIndex(`${seed}:design`, scenario.designBriefs.length)];
    return {
        ...scenario,
        seed: String(seed),
        prompt: `${scenario.prompt}\nVisual direction: ${designBrief}. Choose only the iframe UI libraries that genuinely improve this plugin; do not use libraries merely because they are available.`,
    };
}
