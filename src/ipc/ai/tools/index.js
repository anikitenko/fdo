// tools/index.js
import {getCurrentWeatherTool} from "./weather.js";
import {searchWebTool} from "./search_web";

/**
 * Registry of available AI tools.
 * Each tool must export: name, description, input_schema, shouldActivate(prompt), handler(input)
 */
export const TOOL_REGISTRY = [
    getCurrentWeatherTool,
    searchWebTool,
];

/**
 * Get all tools relevant to the given prompt.
 * Returns definitions (for LLM) and their handlers.
 */
export function getActiveTools(prompt) {
    return TOOL_REGISTRY.filter(t => {
        try {
            return t.shouldActivate?.(prompt);
        } catch {
            return false;
        }
    });
}

/**
 * Execute all tool calls from the model output.
 * Returns an array of results.
 */
export async function runToolCalls(toolCalls = []) {
    const results = [];
    for (const call of toolCalls) {
        const tool = TOOL_REGISTRY.find(t => t.name === call.name);
        if (!tool) {
            results.push({ name: call.name, error: "Unknown tool" });
            continue;
        }
        try {
            const res = await tool.handler(call.input);
            results.push(res);
        } catch (e) {
            results.push({ name: call.name, error: String(e?.message || e) });
        }
    }
    return results;
}
