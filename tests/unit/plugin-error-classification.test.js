import {classifyPluginError} from "../../src/utils/pluginErrorClassification";

describe("classifyPluginError", () => {
    test("classifies signature verification failures as non-retryable", () => {
        const result = classifyPluginError("verification_failed", "Signature is invalid.");
        expect(result).toEqual({
            category: "signature",
            summary: "Plugin signature check failed.",
            retryable: false,
        });
    });

    test("classifies render/iframe failures as retryable render errors", () => {
        const result = classifyPluginError("unloaded", "iframe module did not export a default component");
        expect(result).toEqual({
            category: "render",
            summary: "Plugin UI failed to render.",
            retryable: true,
        });
    });

    test("classifies startup/load failures as runtime errors", () => {
        const result = classifyPluginError("load_failed", "Cannot find module '/plugin/index.cjs'");
        expect(result).toEqual({
            category: "runtime",
            summary: "Plugin runtime failed to start.",
            retryable: true,
        });
    });

    test("classifies process exits as runtime errors", () => {
        const result = classifyPluginError("process_exit", "Exit code 1");
        expect(result).toEqual({
            category: "runtime",
            summary: "Plugin process stopped unexpectedly.",
            retryable: true,
        });
    });

    test("falls back to unknown classification for unrecognized reasons", () => {
        const result = classifyPluginError("unloaded", "Some unexpected condition");
        expect(result).toEqual({
            category: "unknown",
            summary: "Plugin was unloaded unexpectedly.",
            retryable: true,
        });
    });
});

