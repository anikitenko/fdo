// Confirmed reasoning and declared buffered generation get a bounded completion
// allowance. Local heartbeats and generic progress never extend this deadline.
export function createCodingFirstContentDeadline({timeoutMs, abort, provider = "", describeTransport = () => "", maximumWaitMs = timeoutMs * 3}) {
    const startedAt = Date.now();
    let reasoningReceived = false;
    let generationStarted = false;
    let buffered = false;
    let extended = false;
    let done = false;
    let timer;
    let rejectFailure;
    const promise = new Promise((_, reject) => {rejectFailure = reject;});
    const arm = budget => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (done) return;
            done = true;
            const seconds = Math.round(budget / 1000);
            const message = buffered
                ? `The provider returns this response all at once, but generation did not finish within the ${seconds}-second buffered-response budget. The request was stopped. Reduce the file scope or raise the initial response timeout.`
                : reasoningReceived
                ? `The assistant was reasoning but produced no answer within the ${seconds}-second reasoning budget. The request was stopped. Reduce the task size or raise the initial response timeout.`
                : generationStarted
                ? `The assistant started working but produced no answer within the ${seconds}-second generation budget. The request was stopped. Reduce the task size or raise the initial response timeout.`
                : `No answer text was received within FDO's ${seconds}-second first-response deadline. The request was stopped. Adjust the first-response timeout in the assistant settings or retry.`;
            const transport = describeTransport();
            const failure = new Error(message + (!reasoningReceived && !generationStarted && !buffered && provider === "ollama"
                ? " Local model loading and prompt/image processing can also cause this delay." : "") + (transport ? ` ${transport}` : ""));
            if (!reasoningReceived && !generationStarted && !buffered) failure.code = 'stream_stalled';
            else failure.code = buffered ? 'buffered_response_timeout' : reasoningReceived ? 'reasoning_timeout' : 'generation_timeout';
            rejectFailure(failure); abort();
        }, Math.max(0, startedAt + budget - Date.now()));
    };
    const extend = () => {
        if (done || extended) return;
        extended = true;
        arm(Math.max(timeoutMs, maximumWaitMs));
    };
    arm(timeoutMs);
    return {
        promise,
        noteGeneration() {if (done) return; generationStarted = true; extend();},
        noteReasoning() {if (done) return; reasoningReceived = true; extend();},
        noteBuffered() {if (done) return; buffered = true; extend();},
        clear() {done = true; clearTimeout(timer);},
    };
}

// Once the answer has begun, a stream that simply stops — upstream stall,
// half-closed socket — would otherwise hang until the remote side gives up.
// Two bounds after first content: an idle bound (no response event of any
// kind for idleTimeoutMs) and a total completion bound for the whole answer.
// Both are cleared when the stream finishes normally.
export function createCodingAnswerDeadline({timeoutMs, idleTimeoutMs, abort, describeTransport = () => ""}) {
    let started = false;
    let idlePaused = false;
    let done = false;
    let rejectFailure;
    let idleTimer;
    let totalTimer;
    const promise = new Promise((_, reject) => { rejectFailure = reject; });
    const stopTimers = () => {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
    };
    const fail = message => {
        if (done) return;
        done = true;
        stopTimers();
        const transport = describeTransport();
        // Reject with the diagnosis before abort can race it with a generic
        // transport AbortError. A stalled or unfinished stream is a transport
        // fault, not a model verdict: the typed code lets the shared bounded
        // transient retry replay this atomic workspace step once.
        const failure = new Error(message + (transport ? ` ${transport}` : ""));
        failure.code = "stream_stalled";
        rejectFailure(failure);
        abort();
    };
    const touch = () => {
        if (!started || done || idlePaused) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            const seconds = Math.round(idleTimeoutMs / 1000);
            fail(`The assistant stopped sending response events for ${seconds} seconds after the answer began, so the stream was treated as stalled and the request was stopped. Retry or check the provider status.`);
        }, idleTimeoutMs);
    };
    return {
        promise,
        start() {
            if (started || done) return;
            started = true;
            totalTimer = setTimeout(() => {
                const seconds = Math.round(timeoutMs / 1000);
                fail(`The assistant began an answer but did not finish within ${seconds} seconds. The request was stopped. Retry, reduce the task size or raise the first-response timeout in the assistant settings.`);
            }, timeoutMs);
            touch();
        },
        touch,
        pauseIdle() {idlePaused = true; clearTimeout(idleTimer);},
        resumeIdle() {idlePaused = false; touch();},
        clear() {
            if (done) return;
            done = true;
            stopTimers();
        },
    };
}
