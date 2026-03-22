import { buildFdoSearchResult, findFdoMatchesDetailed, looksLikeFdoQuestion } from "./search_fdo_shared.js";
import { recordFdoRetrievalMetrics } from "../metrics.js";

export const searchFdoHelpTool = {
    name: "search_fdo_help",
    description: "Search user-facing FlexDevOps help, docs, dialogs, and settings sources for grounded product answers",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "The FDO product/help question or search query" },
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
                return { name: "search_fdo_help", ok: false, error: "Query is required" };
            }

            const scope = String(input?.scope || "general").trim() || "general";
            const { results, diagnostics } = findFdoMatchesDetailed(query, { mode: "help", scope });
            console.log("[FDO Retrieval]", JSON.stringify({
                tool: "search_fdo_help",
                query,
                mode: "help",
                scope,
                diagnostics,
            }, null, 2));
            const built = buildFdoSearchResult("search_fdo_help", query, results, "help", scope, diagnostics);
            recordFdoRetrievalMetrics({
                tool: "search_fdo_help",
                query,
                scope,
                result: built,
            });
            return built;
        } catch (err) {
            recordFdoRetrievalMetrics({
                tool: "search_fdo_help",
                query: String(input?.query || "").trim(),
                scope: String(input?.scope || "general").trim() || "general",
                error: String(err?.message || err),
            });
            return { name: "search_fdo_help", ok: false, error: String(err?.message || err) };
        }
    },
};
