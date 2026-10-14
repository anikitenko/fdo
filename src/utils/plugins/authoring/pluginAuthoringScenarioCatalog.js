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
        prompt: `Build a JSON Inspector plugin for my day-to-day DevOps work. I want to paste JSON from configs or API responses and click Inspect JSON to check whether it is valid. Show a helpful error for malformed input, or a concise summary with the value type, top-level item count, and top-level keys where applicable.
Give it a clearly labelled editor, a useful empty state, feedback while inspecting, and an easy-to-read result area. Make it a polished, compact tool with a spacious editor, a prominent Inspect JSON button, and visually distinct success and error feedback. Keep it usable on narrow screens and respect reduced-motion preferences.
Everything should work locally without credentials or sending my input anywhere. Add tests for valid JSON, malformed input, and the main interactions.`,
        followUp: "Add a clearly labelled Reset action that clears the JSON input and result display. Preserve the Inspect JSON behavior and existing tests; update tests only when needed.",
    },
    {
        id: "rose-calculator",
        title: "Rose Calculator",
        seed: "rose-calculator-v1",
        designBriefs: [
            "an elegant rose atelier with an ivory work surface and berry accents",
            "a refined floral calculator with dark plum chrome and warm rose controls",
            "a compact luxury utility panel with layered pink surfaces and crisp contrast",
        ],
        prompt: `Build a Rose Calculator plugin for quick calculations during my day-to-day DevOps work. Let me type arithmetic expressions with decimals, parentheses, addition, subtraction, multiplication (* or ×), and division (/ or ÷). Equals should show the answer, invalid expressions should show a helpful error, and Clear should empty the input and result.
Add quick actions to double the current number, halve it, or add 10; doubling 12 should change the display to 24. Include a sidebar where I can view the last successful calculation and switch between rose themes.
Give it a polished rose, berry, and plum design with layered surfaces and a large, clearly recognizable cat illustration across the background, visible behind and around the calculator without getting in the way. Put the sidebar beside the calculator on desktop and stack them on narrow screens. Label controls clearly and respect reduced-motion preferences.
Everything should work locally without credentials or sending my input anywhere. Add tests for calculations, invalid input, Clear, quick actions, history, and theme switching.`,
        followUp: "Keep the existing behavior. Add a Rose memory action that stores and restores the last successful result, and add tests for it.",
    },
    {
        id: "web-tools-workbench",
        title: "Web Tools Workbench",
        seed: "web-tools-workbench-v1",
        designBriefs: ["a calm, polished workspace", "a compact, welcoming developer toolbox"],
        prompt: `Build a Web Tools Workbench plugin inspired by the attached screenshot. Give it a dashboard with categories, a searchable tool library, and a personal space for favourite tools that I can reopen later.
Include a JSON formatter; text case conversion and word/character counts; URL encoding and decoding; an HTML overview covering the title, description, headings, links and missing image descriptions; image information from pasted SVG or data URLs; and a social preview from a title, description and URL.
Everything should work locally without fetching URLs or sending my input anywhere. Show useful results and helpful errors for invalid input. Make navigation clear, label the controls accessibly, and keep the interface usable on narrow screens. Follow the screenshot's visual style, but choose your own branding. Add tests for the tools and their error cases.`,
        followUp: "Keep the existing tools working and make it easier to find my favourites.",
    },
    {
        id: "web-tools-workbench-contract",
        title: "Web Tools Workbench",
        seed: "web-tools-workbench-contract-v1",
        designBriefs: [
            "a polished dark workspace for small webmaster utilities with warm ivory surfaces",
            "a compact web-operations desk with forest navy chrome and softly coloured folder tiles",
        ],
        prompt: "Create a functional Web Tools Workbench plugin: a local, polished dashboard inspired by a compact webmaster-tool library. It must use only deterministic browser-local logic: no network, shell commands, cloud credentials, host APIs, external images, or dependencies. Set metadata.icon to exactly \"applications\", a verified BlueprintJS v6 icon name. Keep /index.ts as the plugin entry, /render.tsx as the rendering composition entry, /styles.css for shared structural styles, and /render.test.ts for composition tests. Create additional cohesive plugin-local modules with relative imports for screens, category tools, action bindings, and focused node:test suites. Keep entry files thin; avoid combining every screen and tool into one large file. A useful decomposition groups dashboard/library/personal-space rendering separately from category workspaces and self-contained action handlers. Keep modules concise and readable, with no minimum line count; share common behavior rather than duplicating it. Plan only cohesive modules needed for the task; the staged generator controls inventory size and admits additional split helpers against its remaining request budget. Do not combine unrelated features to meet an arbitrary final file count. Do not edit the existing /package.json or add dependencies. The plugin entry must import FDO_SDK, FDOInterface, and PluginMetadata from @anikitenko/fdo-sdk, export a class that extends FDO_SDK and implements FDOInterface, and instantiate that class. Never use BasePlugin or FDOPlugin: neither is exported by the installed runtime and either will crash the deployed plugin. Use @anikitenko/fdo-sdk DOM helpers, not React or JSX: create one DOM instance, build markup with that instance, apply imported CSS style-map entries with dom.createClassFromStyle(...), and call dom.renderHTML(...). Do not use static DOM.createElement.\n\nBuild these complete visible states with the exact data roles. The dashboard has data-role=\"tool-workbench\", data-role=\"tool-brand\", data-role=\"tool-dashboard\", a type=\"button\" data-role=\"tool-library-button\", a type=\"button\" data-role=\"tool-space-button\", and a type=\"button\" data-role=\"tool-card-json\" JSON Formatter quick-access control. Clicking that dashboard control opens the JSON workspace. Keep it separate from the library control data-role=\"tool-open-json\"; render and bind both controls. It presents folder-like category tiles for Text & Content, Development & Data, Web & SEO, Images & Media, and Social & Platforms. The tool library is data-role=\"tool-library\" and starts data-state=\"closed\". It has data-role=\"tool-search\", type=\"button\" data-role=\"tool-open-json\", and a type=\"button\" data-role=\"tool-library-close\". Opening the library sets data-state=\"open\"; typing JSON keeps the JSON Formatter option visible. Opening JSON Formatter shows data-role=\"tool-workspace\" with type=\"button\" data-role=\"tool-back-dashboard\", data-role=\"tool-json-input\", type=\"button\" data-role=\"tool-format-json\", and data-role=\"tool-json-result\". Format valid JSON locally with JSON.parse/JSON.stringify using two-space indentation; set the result data-state=\"success\" and visibly show the formatted object. Malformed JSON must set data-state=\"error\" with a helpful message. The personal-space sheet is data-role=\"tool-space-dialog\", starts data-state=\"closed\", and has type=\"button\" data-role=\"tool-space-close\". The space button opens it and the close button restores closed state. Use defineRenderOnLoadActions(...) with declarative click bindings for every button above. Do not use manual listeners or the host-reserved data-bound / element.dataset.bound marker.\n\nTreat the attached reference as the visual specification. Build all of its product states, not just a generic card grid: (1) a deep-teal dashboard with a small warm wordmark, title and short subtitle, two quick-access cards, five compact pastel folder category tiles, and an anchored bottom dock; (2) an ivory JSON Formatter work surface with back action, clear input/result editor areas, a format action, and visible ready/success/error feedback; (3) a light library overlay with a prominent search field, category filters, quick-access rows, and a close action; and (4) a dimmed-background, rounded personal-space sheet with a close action, simple tabs or sections, saved/favourite tool rows, and a short local-only privacy note. Use generous spacing, crisp borders, readable labels, and a restrained dark-teal/ivory/muted-pastel palette. The library and personal-space panels must layer above the dashboard; closed workspaces must not leave visible controls below the active state.\n\nMatch the reference’s product feel without copying its branding: dark deep-teal full-height background, warm ivory workspace surfaces, a small wordmark, a two-column tool dashboard at desktop widths, compact folder-like tiles with distinct muted colours, a visible dock/footer, and an overlay or sheet for the library and personal space. Put that structural design in plugin-local CSS, not only in inline styles. Split substantial styles into shared and feature CSS files using quoted relative @import directives, with /styles.css as a thin composition stylesheet. Imports must precede local rules; keep responsive/state/reduced-motion rules with their owning feature. Across those stylesheets: .shell must literally have both a background and min-height; .dashboard must literally use display:grid with grid-template-columns for two desktop columns; .dock must have position:sticky, position:fixed, or a border; and a mobile @media rule must literally set .dashboard to grid-template-columns: 1fr. The dashboard should remain readable at narrow widths using that mobile @media layout. Use injected Pure CSS: a pure-form pure-form-stacked formatter form and a pure-button pure-button-primary Format JSON action; do not import Pure CSS. Import /styles.css as css. Render all seven style-map classes explicitly: dom.createClassFromStyle(css.shell), css.dashboard, css.card, css.library, css.workspace, css.result, and css.dock. The stylesheet compiler is deliberately small: use flat component rules and exactly one simple nested rule such as `.shell { & button { ... } }`. Do not use nested attribute selectors, :not(...), comma-separated nested selectors, generated selector interpolation, or quoted attribute values in CSS. Put each responsive or state rule in a separate simple selector. Include @keyframes and @media (prefers-reduced-motion: reduce) with animation: none. Add at least two node:test and node:assert/strict tests covering the dashboard title, all interactive targets, and formatter markup. Return only complete workspace file sections, no prose. Keep each module concise enough to generate as a complete file. Preserve every required screen and tool behavior across the modules; do not compress the whole workspace into a single large response. Use the staged file protocol when supplied. Apply complete plugin workspace files.",
        followUp: "Keep the dashboard behavior. Add a local URL encoder tool card and node:test coverage without using network access.",
    }
]);

const WEB_TOOLS_WORKBENCH_FUNCTIONAL_REQUIREMENTS = `
Make every category tile a real local developer tool, not a decorative card. Use button roles data-role="tool-card-text", data-role="tool-card-data", data-role="tool-card-seo", data-role="tool-card-images", and data-role="tool-card-social". Each card opens its own category-specific workspace with data-role="tool-category-workspace" and a stable data-tool-category value matching its card key; do not reuse or mutate one generic category workspace. Every category workspace contains data-role="tool-category-input", type="button" data-role="tool-category-action", data-role="tool-category-result" initially data-state="idle", and type="button" data-role="tool-category-back". The Social & Platforms workspace must expose name="title", name="description", and name="url" inputs; it must also accept the fallback JSON object {"title":"…","description":"…","url":"https://…"} in its first category input. Implement deterministic browser-local tools: Text & Content converts text to uppercase/lowercase/title case and reports character/word counts; Development & Data formats JSON and encodes/decodes URL query text; Web & SEO analyzes pasted HTML for title, description, headings, links, and image-alt coverage; Images & Media inspects pasted data URLs or SVG text locally and reports type, dimensions when available, and size; Social & Platforms generates a local social-preview summary from title, description, and URL fields without fetching the URL. In the Text & Content workspace, expose one labelled native select with option values "upper", "lower", and "title" for the three transformations. In Development & Data, expose one labelled native select with option values "json", "encode", and "decode" for its operations. Read the current selected value when the user runs the action; any initial default is allowed. Valid input sets result data-state="success"; invalid input sets data-state="error" with a helpful message. Bind every category card, action, and back button through defineRenderOnLoadActions(...), with no manual listeners. Add node:test coverage for every category role and each deterministic tool. In node:test, call the render function and only pass its returned HTML string to assert.match. renderOnLoad() returns an action object, not HTML: never pass that object directly to assert.match; if its generated source must be tested, call String(renderOnLoad().source || "") first.
`;

function stableIndex(seed, size) {
    let hash = 2166136261;
    for (const character of String(seed || "")) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % size;
}

export function selectPluginAuthoringScenario(seed = "json-inspector-v1") {
    const normalizedSeed = String(seed || "");
    const scenario = PLUGIN_AUTHORING_SCENARIOS.find((item) => item.seed === normalizedSeed || item.id === normalizedSeed)
        || PLUGIN_AUTHORING_SCENARIOS[stableIndex(normalizedSeed, PLUGIN_AUTHORING_SCENARIOS.length)];
    return buildScenario(scenario, normalizedSeed);
}

function buildScenario(scenario, seed) {
    const designBrief = scenario.designBriefs[stableIndex(`${seed}:design`, scenario.designBriefs.length)];
    const functionalRequirements = scenario.id === "web-tools-workbench-contract"
        ? WEB_TOOLS_WORKBENCH_FUNCTIONAL_REQUIREMENTS
        : "";
    return {
        ...scenario,
        seed,
        designBrief,
        prompt: `${scenario.prompt}${functionalRequirements}\nVisual direction: ${designBrief}. `,
    };
}

export function selectPluginAuthoringScenarioById(id, seed = id) {
    const scenario = PLUGIN_AUTHORING_SCENARIOS.find((item) => item.id === String(id || ""));
    if (!scenario) {
        throw new Error(`Unknown plugin authoring scenario: ${id}`);
    }
    return buildScenario(scenario, seed === id ? scenario.seed : seed);
}
