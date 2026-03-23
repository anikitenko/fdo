import {
    detectPreferredAiChatUiLanguage,
    getAiChatRoleLabel,
    getAiChatSourceTypeLabel,
    getAiChatText,
    normalizeAiChatUiLanguage,
} from "../src/utils/aiChatI18n.js";

describe("AI chat i18n helpers", () => {
    test("normalizes supported UI languages conservatively", () => {
        expect(normalizeAiChatUiLanguage("uk-UA")).toBe("uk");
        expect(normalizeAiChatUiLanguage("en-US")).toBe("en");
        expect(normalizeAiChatUiLanguage("pl")).toBe("en");
        expect(normalizeAiChatUiLanguage("")).toBe("en");
    });

    test("returns Ukrainian chat labels", () => {
        expect(getAiChatText("uk", "chatTitle")).toBe("Чат з AI-асистентом");
        expect(getAiChatText("uk", "sourcesUsed")).toBe("Використані джерела");
        expect(getAiChatRoleLabel("uk", "assistant")).toBe("Відповідь асистенту");
        expect(getAiChatSourceTypeLabel("uk", "docs")).toBe("Документація");
    });

    test("falls back to English for unsupported locales", () => {
        expect(getAiChatText("de", "send")).toBe("Send");
    });

    test("detectPreferredAiChatUiLanguage defaults to a supported locale", () => {
        expect(["en", "uk"]).toContain(detectPreferredAiChatUiLanguage());
    });
});
