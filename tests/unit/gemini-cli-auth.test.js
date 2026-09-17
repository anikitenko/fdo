import { 
    normalizeGeminiAuthState, 
    getGeminiCredentialFilePaths, 
    parseGeminiProbeOutput 
} from "../../src/utils/geminiCli.js";

describe("Gemini CLI Auth Utils", () => {
    const TOKEN = "FDO_AUTH_PROBE_OK_77b2";

    describe("parseGeminiProbeOutput", () => {
        test("identifies TOKEN in raw text", () => {
            expect(parseGeminiProbeOutput(TOKEN)).toBe(true);
        });

        test("identifies TOKEN in JSON output", () => {
            expect(parseGeminiProbeOutput(JSON.stringify({ content: TOKEN }))).toBe(true);
            expect(parseGeminiProbeOutput(JSON.stringify({ text: TOKEN }))).toBe(true);
        });

        test("identifies TOKEN with filler text", () => {
            expect(parseGeminiProbeOutput(`Here is the token: ${TOKEN}`)).toBe(true);
            expect(parseGeminiProbeOutput(JSON.stringify({ content: `The token is **${TOKEN}**.` }))).toBe(true);
        });

        test("rejects partial matches or broad 'OK'", () => {
            expect(parseGeminiProbeOutput("OK")).toBe(false);
            expect(parseGeminiProbeOutput("The status is OK")).toBe(false);
        });

        test("rejects output with URLs even if token is present elsewhere", () => {
            expect(parseGeminiProbeOutput(`${TOKEN} and visit https://google.com`)).toBe(false);
        });

        test("handles mixed JSON and non-JSON output containing TOKEN", () => {
            const output = "Checking system...\n" + JSON.stringify({ content: TOKEN });
            expect(parseGeminiProbeOutput(output)).toBe(true);
        });

        test("accepts common success hints even when TOKEN is absent", () => {
            expect(parseGeminiProbeOutput("Already logged in as alex@example.com")).toBe(true);
            expect(parseGeminiProbeOutput(JSON.stringify({ content: "Already authenticated. No action required." }))).toBe(true);
            expect(parseGeminiProbeOutput("You are signed in to Gemini CLI.")).toBe(true);
        });

        test("does not treat negative auth hints as success", () => {
            expect(parseGeminiProbeOutput("Not logged in. Login required.")).toBe(false);
            expect(parseGeminiProbeOutput(JSON.stringify({ content: "Not authenticated. Please sign in." }))).toBe(false);
        });

        test("accepts success hints even when output also contains unrelated JSON lines", () => {
            const output = [
                JSON.stringify({ event: "status", level: "info" }),
                "Already logged in as alex@example.com",
            ].join("\n");
            expect(parseGeminiProbeOutput(output)).toBe(true);
        });
    });
});
