import { getQuickEmojiPalette, searchEmojiPalette } from "../../src/utils/emoticons.js";

describe("quick emoji palette", () => {
    test("includes a broader curated set with thumbs-up variants", () => {
        const palette = getQuickEmojiPalette();
        const labels = palette.map((item) => item.label);
        const thumbsUpVariants = labels.filter((label) => label.toLowerCase().startsWith("thumbs up"));

        expect(palette.length).toBeGreaterThanOrEqual(24);
        expect(labels).toContain("thumbs up");
        expect(thumbsUpVariants.length).toBeGreaterThanOrEqual(4);
        expect(labels).toContain("flag: Ukraine");
    });

    test("searches by label, tag, and emoticon alias", () => {
        const rocketResults = searchEmojiPalette("rocket");
        const bugResults = searchEmojiPalette("bug");
        const winkResults = searchEmojiPalette(";)");

        expect(rocketResults.some((item) => item.label.toLowerCase().includes("rocket"))).toBe(true);
        expect(bugResults.some((item) => item.label.toLowerCase().includes("bug"))).toBe(true);
        expect(winkResults.some((item) => item.label.toLowerCase().includes("wink"))).toBe(true);
    });
});
