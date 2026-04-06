import {
    clearCodexJsonModeCooldown,
    CODEX_JSON_COOLDOWN_MS,
    getCodexJsonModeCooldownState,
    markCodexJsonModeCooldown,
    shouldUseCodexJsonMode,
} from "../../src/utils/codexCliJsonModePreference.js";

describe("codex CLI JSON mode preference", () => {
    const preference = {
        assistantId: "assistant-1",
        model: "gpt-5.4-mini",
        command: "codex",
    };

    afterEach(() => {
        clearCodexJsonModeCooldown(preference);
        jest.restoreAllMocks();
    });

    test("disables JSON mode after a progress-only failure", () => {
        jest.spyOn(Date, "now").mockReturnValue(1_000);

        markCodexJsonModeCooldown(preference);

        expect(shouldUseCodexJsonMode(preference)).toBe(false);
        expect(getCodexJsonModeCooldownState(preference)).toEqual(
            expect.objectContaining({
                failures: 1,
                reason: "progress-only-json",
                until: 1_000 + CODEX_JSON_COOLDOWN_MS,
            }),
        );
    });

    test("extends cooldown after repeated progress-only failures", () => {
        const nowSpy = jest.spyOn(Date, "now");
        nowSpy.mockReturnValue(2_000);
        markCodexJsonModeCooldown(preference);

        nowSpy.mockReturnValue(5_000);
        markCodexJsonModeCooldown(preference);

        expect(getCodexJsonModeCooldownState(preference)).toEqual(
            expect.objectContaining({
                failures: 2,
                reason: "progress-only-json",
                until: 5_000 + (CODEX_JSON_COOLDOWN_MS * 2),
            }),
        );
    });
});
