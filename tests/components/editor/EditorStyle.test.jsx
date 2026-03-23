import EditorStyle, { QUICK_INPUT_POSITION_STYLES } from "../../../src/components/editor/monaco/EditorStyle";

describe("EditorStyle quick input positioning", () => {
    afterEach(() => {
        document.head.innerHTML = "";
    });

    test("uses a fixed centered quick input layout", () => {
        expect(QUICK_INPUT_POSITION_STYLES).toContain("position: fixed !important;");
        expect(QUICK_INPUT_POSITION_STYLES).toContain("left: 50% !important;");
        expect(QUICK_INPUT_POSITION_STYLES).toContain("transform: translateX(-50%) !important;");
        expect(QUICK_INPUT_POSITION_STYLES).toContain("width: min(680px, calc(100vw - 32px)) !important;");
        expect(QUICK_INPUT_POSITION_STYLES).not.toContain("top: 0 !important;");
    });

    test("injects the Monaco quick input styles only once", () => {
        EditorStyle();
        EditorStyle();

        const matchingStyleNodes = Array.from(document.head.querySelectorAll("style"))
            .filter((node) => node.textContent.includes(".quick-input-widget"));

        expect(matchingStyleNodes).toHaveLength(1);
        expect(matchingStyleNodes[0].textContent).toContain("left: 50% !important;");
    });
});
