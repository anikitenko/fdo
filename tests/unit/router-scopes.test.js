import { getClarificationScopes } from "../../src/ipc/ai/tools/index.js";

describe("router clarification scopes", () => {
    test("FDO clarification scopes come from the canonical scope registry in stable UX order", () => {
        expect(getClarificationScopes("fdo", "en")).toEqual([
            { scope: "ui", label: "FDO UI" },
            { scope: "settings", label: "settings" },
            { scope: "plugins", label: "plugins" },
            { scope: "trust", label: "trust/certificates" },
            { scope: "sdk", label: "SDK" },
            { scope: "code_dev", label: "implementation details" },
        ]);
    });

    test("FDO clarification scopes are localized for Ukrainian", () => {
        expect(getClarificationScopes("fdo", "uk")).toEqual([
            { scope: "ui", label: "інтерфейс FDO" },
            { scope: "settings", label: "налаштування" },
            { scope: "plugins", label: "плагіни" },
            { scope: "trust", label: "довіра й сертифікати" },
            { scope: "sdk", label: "SDK" },
            { scope: "code_dev", label: "деталі реалізації" },
        ]);
    });

    test("non-FDO routes do not expose FDO clarification scopes", () => {
        expect(getClarificationScopes("general", "en")).toEqual([]);
        expect(getClarificationScopes("weather", "uk")).toEqual([]);
    });
});
