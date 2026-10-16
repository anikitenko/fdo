import {starterFiles} from './templates/starterFiles';
import {STARTER_STYLES} from './templates/starterStyles';
import {resolvePluginTemplate} from '../../../utils/plugins/authoring/pluginTemplateCatalog';
import {packageJsonContent} from './packageJsonContent';

function escapeTemplateText(value = 'My Plugin') {
    return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
}

export const BLANK_TEMPLATE_MAIN = (name) => {
    const data_class_header = `import {defineRenderOnLoadActions, FDO_SDK, FDOInterface, PluginMetadata, PluginRegistry} from '@anikitenko/fdo-sdk';
import {Render} from "./render"

export default class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    private readonly _metadata: PluginMetadata = {
        name: ${JSON.stringify(name)},
        version: "1.0.0",
        author: "Your team",
        description: "A sample FDO plugin",
        icon: "cog",
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }
    `
    const data_init = `
    init(): void {
        PluginRegistry.registerHandler("refreshStatus", () => ({
            success: true,
            message: this.metadata.name + " is running (v" + this.metadata.version + ").",
        }));
        this.info(this.metadata.name + " initialized!", {
            plugin: this.metadata.name,
            version: this.metadata.version,
        });
    }
    `
    const data_render = `
    render(): string {
        const metadata = this.metadata;
        return (Render({
            version: metadata.version,
            author: metadata.author,
            description: metadata.description
        }))
    }
    `
    const data_render_on_load = `
    renderOnLoad() {
        return defineRenderOnLoadActions({
            handlers: {
                refreshStatus: async ({ element }) => {
                    const response = await window.createBackendReq("UI_MESSAGE", {
                        handler: "refreshStatus",
                        content: {
                            plugin: ${JSON.stringify(name)},
                        },
                    });
                    const target = document.querySelector("[data-role=\\"status\\"]");
                    if (target) {
                        target.textContent = String(response?.message || "Status updated");
                    }
                    if (element instanceof HTMLElement) {
                        element.dataset.state = "ready";
                    }
                },
            },
            bindings: [
                {
                    selector: "[data-role=\\"refresh-status\\"]",
                    event: "click",
                    handler: "refreshStatus",
                    preventDefault: true,
                    required: true,
                },
            ],
            // strict: true surfaces selector mismatch diagnostics early during plugin authoring.
            strict: true,
            language: "typescript",
        });
    }
    `
    const data_class_footer = `
}

new MyPlugin();
`
    return data_class_header + data_metadata + data_init + data_render + data_render_on_load + data_class_footer;
}

export const BLANK_TEMPLATE_RENDER = (name) => {
    const dataImports = "import {DOM, DOMNested, DOMText} from '@anikitenko/fdo-sdk';\nimport styles from './styles.css';\n"
    const dataType = "type RenderProps = {\n" +
        "    version: string;\n" +
        "    author: string;\n" +
        "    description: string\n" +
        "}" +
        "\n\n"

    const dataRender = "export const Render = ({ version, author, description }: RenderProps): string => {\n" +
        "    const dom = new DOM();\n" +
        "    const shell = dom.createClassFromStyle(styles.shell);\n" +
        "    const text = new DOMText();\n" +
        "    const myPlugin = dom.createElement('h1', {}, " + JSON.stringify(escapeTemplateText(name)) + ");\n" +
        "    const pVersion = text.createPText(`Version: ${version}`);\n" +
        "    const pAuthor = text.createPText(`Author: ${author}`);\n" +
        "    const pDescription = text.createPText(`Description: ${description}`);\n" +
        "    const refreshButton = new DOM().createElement(\"button\", {\n" +
        "        \"data-role\": \"refresh-status\",\n" +
        "        type: \"button\",\n" +
        "        class: \"pure-button\",\n" +
        "    }, \"Refresh status\");\n" +
        "    const status = new DOM().createElement(\"p\", {\n" +
        "        \"data-role\": \"status\",\n" +
        "    }, \"Click the button to fetch plugin UI status.\");\n" +
        "    const nested = new DOMNested().createBlockDiv([\n" +
        "        myPlugin,\n" +
        "        pVersion,\n" +
        "        pAuthor,\n" +
        "        pDescription,\n" +
        "        refreshButton,\n" +
        "        status\n" +
        "    ]);\n" +
        "    return (\n" +
        "        dom.renderHTML(dom.createElement('main', {class: shell}, nested))\n" +
        "    )\n" +
        "}"
    return dataImports+ dataType + dataRender
}

export const BLANK_TEMPLATE_TEST = (name = 'My Plugin') => `import {test} from "node:test";
import assert from "node:assert/strict";
import {Render} from "./render";

// Run these examples with the editor's Run Tests action.
const props = {version: "2.3.4", author: "Example Author", description: "Example plugin"};

test("renders the plugin details", () => {
    const html = Render(props);
    assert.ok(html.includes(${JSON.stringify(escapeTemplateText(name))}));
    assert.ok(html.includes("Version: 2.3.4"));
    assert.ok(html.includes("Author: Example Author"));
    assert.ok(html.includes("Description: Example plugin"));
});

test("provides the targets used by the refresh action", () => {
    const html = Render(props);
    assert.match(html, /data-role="refresh-status"/);
    assert.match(html, /type="button"/);
    assert.match(html, /data-role="status"/);
    assert.ok(html.includes("Click the button to fetch plugin UI status."));
});
`;

export function createPluginTemplateFiles({name, displayName = name, template = 'blank'}) {
    const selected = resolvePluginTemplate(template);
    const title = String(displayName || name || 'My Plugin').trim();
    const files = selected.value === 'blank' ? {
        '/index.ts': BLANK_TEMPLATE_MAIN(title), '/render.tsx': BLANK_TEMPLATE_RENDER(title), '/render.test.ts': BLANK_TEMPLATE_TEST(title), '/styles.css': STARTER_STYLES,
    } : starterFiles(title, selected.value);
    files['/package.json'] = packageJsonContent(name);
    files['/SKILL.md'] = `# ${title.replace(/[\r\n]/g, ' ')} development guide

## Purpose and user flow
${selected.description}
This is the ${selected.title} starter. ${selected.value === 'service' || ['dashboard', 'horDivided', 'verDivided', 'splitGrid'].includes(selected.value) ? 'All service results and metrics are explicitly labelled demo data; no external requests or credentials are used.' : 'Actions run locally.'}

## Modules and contracts
- /index.ts owns plugin metadata, lifecycle, registered backend handlers and declarative renderOnLoad bindings. Instantiate the plugin at module scope.
- /render.tsx renders the interface. Keep action selectors and accessible labels consistent with bindings.
${selected.value === 'blank' ? '- /styles.css defines the registered page style.\n- /render.test.ts tests the render contract.' : '- /logic.ts owns independently testable behavior. Service Monitor keeps its demo adapter here.\n- /styles.css contains standard CSS (not SCSS). Import its default style map and register entries on one SDK DOM instance and finish with that same instance’s renderHTML.\n- /text.ts escapes plain text before inserting it into HTML.\n- /starter.test.ts tests behavior and emitted styles.'}
- /package.json declares index.ts as source and dist/index.cjs as the deployment artifact. Never replace source with compiled code.

${selected.value === 'splitGrid' ? '## Split Grid layout\n/split-layout.ts is serialized as the renderOnLoad setup callback; keep it self-contained. Use the injected window.Split, without an npm import. It destroys old instances/listeners on rerender, retains the current ratio within the iframe, and stacks panels at 640px. The separator supports drag, Left/Right, Shift+arrows and Home/End. Read the SDK 07-injected-libraries-demo example for the base API.\n' : ''}
${selected.value === 'dialogs' ? '## Dialog behavior\nUse the native dialog showModal()/close() methods for focus containment, Escape handling and focus restoration. The plugin iframe blocks native form submission: use the explicit Save click and input Enter bindings, not a submit button. Save settings validates unknown input in /logic.ts and updates session-local state in /index.ts; nothing is deployed or sent externally. Keep labels, form validation, error feedback and busy-state protection. Styling includes ::backdrop, focus/disabled states, gradients, descendants and narrow-screen media rules.\n' : ''}
## SDK conventions
Use supported @anikitenko/fdo-sdk APIs. DOM builders return HTML strings, not browser elements. Backend handlers receive unknown input: validate it before use. renderOnLoad bindings run in the iframe, so callbacks must not rely on backend closure variables. Preserve all CSS style entries and register them through DOM.createClassFromStyle.

## Extending and validating
Run Tests, then Build / Compile in the IDE. These instructions do not claim any tests have run for this workspace.
${selected.value === 'service' ? 'To connect a real service, replace the demo adapter, declare the required capabilities, and use the current host network/auth contracts. Request endpoint scope and credentials explicitly; never hard-code secrets or send requests from render(). Keep demo mode available for tests.' : 'Keep tests meaningful when changing behavior and preserve unrelated functionality.'}
${['dashboard', 'horDivided', 'verDivided', 'splitGrid'].includes(selected.value) ? 'Quickbar and sidebar actions name handlers registered in init(). The host selects the plugin and refreshes its view after successful actions.' : ''}
`;
    files['/README.md'] = `# ${title.replace(/[\r\n]/g, ' ')}

Created from the **${selected.title}** template.

${selected.description}

1. Open /index.ts to customize metadata and handlers.
2. Run Tests in the editor.
3. Build / Compile and Deploy when ready.

Read /SKILL.md before changing the workspace. Existing saved workspaces are restored without applying this template over them.
`;
    return files;
}
