import {shouldIncludeProjectContext} from "../../src/components/editor/utils/aiCodingAgentContextPolicy.js";

describe("ai coding agent context policy", () => {
    test("includes project context for plan requests targeting current plugin implementation", () => {
        expect(shouldIncludeProjectContext({
            action: "plan",
            prompt: "please fix my current plugin implementation and make it best practice according to SDK",
            selectedCode: "",
            currentFileContext: "export default class MyPlugin {}",
            sdkKnowledgeEnabled: true,
            externalReferenceEnabled: false,
        })).toBe(true);
    });

    test("keeps external-reference ideation out of project context", () => {
        expect(shouldIncludeProjectContext({
            action: "smart",
            prompt: "I want something better than https://switchhosts.app",
            selectedCode: "",
            currentFileContext: "export default class MyPlugin {}",
            sdkKnowledgeEnabled: false,
            externalReferenceEnabled: true,
        })).toBe(false);
    });

    test("includes project context for plugin metadata rename requests", () => {
        expect(shouldIncludeProjectContext({
            action: "smart",
            prompt: "please change plugin's name in metadata from undefined to something more useful and meaningful",
            selectedCode: "",
            currentFileContext: "export default class MyPlugin { metadata = { name: 'undefined' }; }",
            sdkKnowledgeEnabled: true,
            externalReferenceEnabled: false,
        })).toBe(true);
    });

    test("includes project context for creative metadata naming requests", () => {
        expect(shouldIncludeProjectContext({
            action: "smart",
            prompt: "can you please use for plugin name in metadata something more creative?",
            selectedCode: "",
            currentFileContext: "export default class MyPlugin { metadata = { name: 'undefined' }; }",
            sdkKnowledgeEnabled: true,
            externalReferenceEnabled: false,
        })).toBe(true);
    });
});
