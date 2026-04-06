import {
    extractReferenceUrls,
    formatExternalReferenceContext,
    shouldUseExternalReferenceKnowledge,
    summarizeHtmlReference,
} from "../../src/utils/externalReferenceKnowledge.js";

describe("external reference knowledge", () => {
    test("extracts unique reference urls from prompt text", () => {
        const urls = extractReferenceUrls("Build something like https://example.com/app and compare with https://example.com/app.");
        expect(urls).toEqual(["https://example.com/app"]);
    });

    test("summarizes html references into compact structured data", () => {
        const summary = summarizeHtmlReference("https://example.com", `
            <html>
              <head>
                <title>Example App</title>
                <meta name="description" content="Reference desktop app" />
              </head>
              <body>
                <h1>Core Features</h1>
                <ul>
                  <li>Switch environments quickly</li>
                  <li>Manage multiple profiles safely</li>
                </ul>
              </body>
            </html>
        `);

        expect(summary.title).toBe("Example App");
        expect(summary.description).toBe("Reference desktop app");
        expect(summary.headings).toContain("Core Features");
        expect(summary.bullets.length).toBeGreaterThan(0);
    });

    test("formats external references into prompt context", () => {
        const context = formatExternalReferenceContext([
            {
                url: "https://example.com",
                title: "Example App",
                description: "Reference desktop app",
                headings: ["Core Features"],
                bullets: ["Switch environments quickly"],
                excerpt: "Example body excerpt",
            },
        ]);

        expect(context).toContain("Relevant external reference material");
        expect(context).toContain("https://example.com");
        expect(context).toContain("Switch environments quickly");
    });

    test("only enables external reference retrieval when prompt includes urls", () => {
        expect(shouldUseExternalReferenceKnowledge({
            prompt: "Build something like https://example.com",
        })).toBe(true);

        expect(shouldUseExternalReferenceKnowledge({
            prompt: "Build a production-grade desktop tool",
        })).toBe(false);
    });
});
