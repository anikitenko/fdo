import {normalizeAndValidatePluginMetadata} from "../../src/utils/pluginMetadataContract";

describe("plugin metadata contract alignment", () => {
    test("normalizes lowercase icon values and validates them with the SDK contract", () => {
        const metadata = normalizeAndValidatePluginMetadata({
            name: "Demo Plugin",
            version: "1.0.0",
            author: "Test",
            description: "Demo",
            icon: "COG",
        });

        expect(metadata.icon).toBe("cog");
    });

    test("rejects non-Blueprint icon values instead of silently coercing them", () => {
        expect(() => normalizeAndValidatePluginMetadata({
            name: "Demo Plugin",
            version: "1.0.0",
            author: "Test",
            description: "Demo",
            icon: "icon.png",
        })).toThrow(/BlueprintJS v6 icon name/i);
    });
});
