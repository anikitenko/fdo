import {createCodingFirstContentDeadline, createCodingAnswerDeadline} from './codingFirstContentDeadline';
import {codingFirstResponseTimeoutMs, codingAnswerIdleTimeoutMs} from './codingRequestPolicy.cjs';

// Heartbeats must not extend answer deadlines. Tracked MCP work pauses only
// the idle timer, under its own bound; the total completion bound remains active.
export function cliCodingResponseDeadline(assistant, child, reject, {toolTimeoutMs = 75000} = {}) {
    const timeoutMs = codingFirstResponseTimeoutMs(assistant);
    const first = createCodingFirstContentDeadline({timeoutMs, provider: assistant.provider, abort: () => child.kill()});
    const answer = createCodingAnswerDeadline({timeoutMs: timeoutMs * 3, idleTimeoutMs: codingAnswerIdleTimeoutMs(assistant), abort: () => child.kill()});
    const tools = new Map();
    const reasoning = new Set();
    let stopped = false;
    let toolWorkObserved = false;
    let hookWorkObserved = false;
    const clear = () => {stopped = true; first.clear(); answer.clear(); for (const timer of tools.values()) clearTimeout(timer); tools.clear(); reasoning.clear();};
    const fail = error => {if (stopped) return; clear(); reject(error); child.kill();};
    const timeoutFailure = error => {
        // A replay after external tool execution is not necessarily safe.
        if (toolWorkObserved) {
            error.code = hookWorkObserved ? 'hook_request_timeout' : 'mcp_request_timeout';
            error.message += hookWorkObserved ? ' Hook execution began during this request; retrying may repeat an external action.' : ' MCP execution began during this request; retrying may repeat an external action.';
        }
        clear(); reject(error);
    };
    first.promise.catch(timeoutFailure); answer.promise.catch(timeoutFailure);
    const startWork = (id, isHook = false) => {
            if (stopped || tools.has(id)) return;
            toolWorkObserved = true;
            first.noteGeneration();
            if (isHook) hookWorkObserved = true;
            answer.pauseIdle();
            tools.set(id, setTimeout(() => {
                const failure = new Error(`${isHook ? 'The hook' : 'The MCP call'} did not finish within ${Math.round(toolTimeoutMs / 1000)} seconds. The request was stopped; ${isHook ? 'check the hook command' : 'check the MCP server'} before retrying. A retry may repeat an external action.`);
                failure.code = isHook ? 'hook_execution_timeout' : 'mcp_tool_timeout';
                fail(failure);
            }, toolTimeoutMs));
        };
    return {
        bufferedBeforeAnswer() {if (!stopped) first.noteBuffered();},
        generationStarted() {if (!stopped) first.noteGeneration();},
        content() {if (stopped) return; first.clear(); answer.start(); answer.touch();},
        activity() {if (!stopped) answer.touch();},
        reasoning(activity) {
            if (stopped) return;
            first.noteReasoning();
            if (activity.started && activity.id) reasoning.add(activity.id);
            if (activity.completed) reasoning.delete(activity.id);
            if (reasoning.size || tools.size) answer.pauseIdle();
            else answer.resumeIdle();
            answer.touch();
        },
        toolStarted(id) {startWork(id);},
        hookStarted(id) {startWork(id, true);},
        toolCompleted(id) {
            if (stopped) return;
            clearTimeout(tools.get(id)); tools.delete(id);
            if (!tools.size && !reasoning.size) answer.resumeIdle();
        },
        clear,
    };
}
