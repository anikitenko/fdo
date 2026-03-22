import { buildFdoSearchResult, findFdoMatchesDetailed, looksLikeFdoQuestion } from "./search_fdo_shared.js";
import { recordFdoRetrievalMetrics } from "../metrics.js";

export const searchFdoCodeTool = {
    name: "search_fdo_code",
    description: "Search FlexDevOps implementation/code sources for development, debugging, and internal behavior questions",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "The FDO implementation or code-oriented search query" },
        },
        required: ["query"],
    },

    shouldActivate(prompt) {
        return looksLikeFdoQuestion(prompt);
    },

    async handler(input) {
        try {
            const query = String(input?.query || "").trim();
            if (!query) {
                return { name: "search_fdo_code", ok: false, error: "Query is required" };
            }

            const scope = String(input?.scope || "general").trim() || "general";
            const { results, diagnostics } = findFdoMatchesDetailed(query, { mode: "code", scope });
            console.log("[FDO Retrieval]", JSON.stringify({
                tool: "search_fdo_code",
                query,
                mode: "code",
                scope,
                diagnostics,
            }, null, 2));
            const built = buildFdoSearchResult("search_fdo_code", query, results, "code", scope, diagnostics);
            recordFdoRetrievalMetrics({
                tool: "search_fdo_code",
                query,
                scope,
                result: built,
            });
            return built;
        } catch (err) {
            recordFdoRetrievalMetrics({
                tool: "search_fdo_code",
                query: String(input?.query || "").trim(),
                scope: String(input?.scope || "general").trim() || "general",
                error: String(err?.message || err),
            });
            return { name: "search_fdo_code", ok: false, error: String(err?.message || err) };
        }
    },
};
