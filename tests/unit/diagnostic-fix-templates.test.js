describe("diagnostic fix templates", () => {
    afterEach(() => {
        jest.resetModules();
    });

    test("returns known template and exact fix via SDK helpers", () => {
        const {
            __setOptionalSdkModuleForTests,
            getDiagnosticFixTemplateForCode,
            formatDiagnosticExactFixForCode,
        } = require("../../src/utils/diagnosticFixTemplates");

        __setOptionalSdkModuleForTests({
            getDiagnosticFixTemplate: jest.fn(() => ({
                title: "Known fix",
                summary: "Known summary",
                exactFix: "fallback exact fix",
                steps: ["step one", "step two"],
                docsLinks: [{title: "Docs", url: "https://example.local/docs"}],
            })),
            formatDiagnosticExactFix: jest.fn(() => "formatted exact fix"),
            listDiagnosticFixTemplates: jest.fn(() => ["PROCESS_EXIT_NON_ZERO"]),
        });

        const template = getDiagnosticFixTemplateForCode("process_exit_non_zero", {
            context: "unit-test",
        });
        const exactFix = formatDiagnosticExactFixForCode("PROCESS_EXIT_NON_ZERO", template);

        expect(template).toEqual({
            title: "Known fix",
            summary: "Known summary",
            exactFix: "fallback exact fix",
            steps: ["step one", "step two"],
            docsLinks: [{title: "Docs", url: "https://example.local/docs"}],
        });
        expect(exactFix).toBe("formatted exact fix");
    });

    test("logs unknown codes when SDK helper exists but template is missing", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const {
            __setOptionalSdkModuleForTests,
            __resetReportedUnknownFixTemplatesForTests,
            getDiagnosticFixTemplateForCode,
        } = require("../../src/utils/diagnosticFixTemplates");

        __setOptionalSdkModuleForTests({
            getDiagnosticFixTemplate: jest.fn(() => null),
            listDiagnosticFixTemplates: jest.fn(() => ["KNOWN_CODE"]),
        });
        __resetReportedUnknownFixTemplatesForTests();

        const result = getDiagnosticFixTemplateForCode("UNKNOWN_CODE", {
            context: "unit-test",
        });

        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            "[DIAGNOSTIC_FIX_TEMPLATE_MISSING]",
            expect.stringContaining("\"code\":\"UNKNOWN_CODE\"")
        );
        warnSpy.mockRestore();
    });

    test("keeps silent fallback when SDK helper is unavailable", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const {
            __setOptionalSdkModuleForTests,
            getDiagnosticFixTemplateForCode,
            formatDiagnosticExactFixForCode,
        } = require("../../src/utils/diagnosticFixTemplates");

        __setOptionalSdkModuleForTests({});
        const template = getDiagnosticFixTemplateForCode("PROCESS_EXIT_NON_ZERO");
        const exactFix = formatDiagnosticExactFixForCode("PROCESS_EXIT_NON_ZERO", template);

        expect(template).toBeNull();
        expect(exactFix).toBe("");
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
