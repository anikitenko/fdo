// tools/search_web.js
/**
 * Web Search Tool for AI Chat
 * Performs a quick search using DuckDuckGo Instant API
 */

export const searchWebTool = {
    name: "search_web",
    description: "Search the web for recent information (uses DuckDuckGo instant API)",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query, e.g., 'current AI models 2025'" },
        },
        required: ["query"],
    },

    shouldActivate(prompt) {
        if (!prompt) return false;
        const q = String(prompt).toLowerCase();
        const triggers = [
            "search", "find", "look up", "current", "latest", "today",
            "recent", "news", "update", "google", "web", "internet",
        ];
        return triggers.some(k => q.includes(k));
    },

    async handler(input) {
        try {
            const query = String(input?.query || "").trim();
            if (!query) return { name: "search_web", error: "Query is required" };

            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const res = await fetch(url);
            const data = await res.json();

            const related = Array.isArray(data.RelatedTopics)
                ? data.RelatedTopics.slice(0, 5).map(t => ({
                    text: t.Text,
                    url: t.FirstURL,
                }))
                : [];

            // Create a readable text summary
            let summaryLines = [];
            if (data.Abstract) summaryLines.push(data.Abstract);
            if (related.length > 0) {
                summaryLines.push(
                    "Top results:",
                    ...related.map((r, i) => `${i + 1}. ${r.text} (${r.url})`)
                );
            }

            const textSummary = summaryLines.join("\n");

            return {
                name: "search_web",
                query,
                text: textSummary || `Found ${related.length} web results for "${query}".`,
                data: {
                    heading: data.Heading || "Web Search Results",
                    abstract: data.Abstract || null,
                    results: related,
                },
            };
        } catch (err) {
            return { name: "search_web", error: String(err?.message || err) };
        }
    },
};
