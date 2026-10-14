import {extractCodexJsonProgress, extractCodexJsonToolActivity, extractCodexJsonReasoningActivity, extractCodexJsonEventText, extractCodexFailure, isCodexJsonTurnStarted} from "../../src/utils/ai/codex/codexCliJson.js";

describe("codex CLI JSON progress extraction", () => {
    test("uses friendly wording for turn start", () => {
        const message = extractCodexJsonProgress(JSON.stringify({
            type: "turn.started",
        }));

        expect(message).toBe("Codex is analyzing the request and workspace.");
    });

    test("summarizes internal assistant progress without exposing raw transport details", () => {
        const message = extractCodexJsonProgress(JSON.stringify({
            type: "item.completed",
            item: {
                type: "agentMessage",
                text: "internal planning",
            },
        }));

        expect(message).toBe("Codex is preparing the first answer.");
    });
});

test("reads current Codex snake_case assistant events", () => {
    expect(extractCodexJsonEventText(JSON.stringify({type: "item.completed", item: {type: "agent_message", text: "Generated plugin"}}))).toBe("Generated plugin");
});

test("prefers the actual failed-turn message over stdin notices", () => {
    expect(extractCodexFailure(JSON.stringify({type: "turn.failed", error: {message: "Model unavailable"}}), "Reading additional input from stdin..."))
        .toBe("Model unavailable");
    expect(extractCodexFailure("", "Reading additional input from stdin...\nAuthentication failed")).toBe("Authentication failed");
    expect(extractCodexFailure("", "Reading additional input from stdin...")).toBe("");
});

test('reports MCP tool execution without exposing arguments or result contents', () => {
    const item = {type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: {secret: 'private-argument'}, result: {content: 'private-result'}};
    expect(extractCodexJsonProgress(JSON.stringify({type: 'item.started', item}))).toBe('MCP: calling docs / search.');
    expect(extractCodexJsonProgress(JSON.stringify({type: 'item.completed', item}))).toBe('MCP: docs / search completed.');
    expect(extractCodexJsonProgress(JSON.stringify({type: 'item.completed', item: {...item, error: {message: 'private-error'}}}))).toBe('MCP: docs / search failed.');
});

test('tracks only identified MCP lifecycle events for tool-wait deadlines', () => {
    const item = {id: 'call-one', type: 'mcp_tool_call', server: 'docs', tool: 'search'};
    expect(extractCodexJsonToolActivity(JSON.stringify({type: 'item.started', item}))).toEqual({id: 'call-one', started: true});
    expect(extractCodexJsonToolActivity(JSON.stringify({type: 'item.completed', item}))).toEqual({id: 'call-one', started: false});
    expect(extractCodexJsonToolActivity(JSON.stringify({type: 'item.started', item: {...item, id: undefined}}))).toBeNull();
    expect(extractCodexJsonToolActivity(JSON.stringify({type: 'item.started', item: {...item, type: 'agent_message'}}))).toBeNull();
    expect(extractCodexJsonToolActivity('heartbeat')).toBeNull();
});

test('native reasoning activity is tracked without returning private reasoning text', () => {
    const item = {id: 'reasoning-one', type: 'reasoning', text: 'private reasoning content'};
    expect(extractCodexJsonReasoningActivity(JSON.stringify({type: 'item.started', item}))).toEqual({id: 'reasoning-one', started: true, completed: false});
    expect(extractCodexJsonReasoningActivity(JSON.stringify({type: 'item.completed', item}))).toEqual({id: 'reasoning-one', started: false, completed: true});
    expect(extractCodexJsonReasoningActivity(JSON.stringify({type: 'item.completed', item: {...item, type: 'agent_message'}}))).toBeNull();
    expect(extractCodexJsonReasoningActivity('heartbeat')).toBeNull();
});


test('recognizes native turn start without treating generic messages as generation activity',()=>{
    expect(isCodexJsonTurnStarted('{"type":"turn.started"}')).toBe(true);
    expect(isCodexJsonTurnStarted('{"type":"thread.started"}')).toBe(false);
    expect(isCodexJsonTurnStarted('heartbeat')).toBe(false);
});
