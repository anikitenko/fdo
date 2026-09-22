// Reasoning is activity, but it is not a usable answer and must not extend
// the deadline indefinitely. Retain only that it occurred, never its text.
export function createCodingFirstContentDeadline({timeoutMs, abort, provider = "", describeTransport = () => ""}) {
    let reasoningReceived = false;
    let timer;
    const promise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const seconds = Math.round(timeoutMs / 1000);
            const message = reasoningReceived
                ? `The assistant produced reasoning but no answer text within ${seconds} seconds. The request was stopped. Choose a non-thinking/instruct model or reduce the task size.`
                : `No answer text was received within FDO's ${seconds}-second first-response deadline. The request was stopped. Adjust the first-response timeout in the assistant settings or retry.`;
            // Reject with the useful diagnosis before abort can race it with
            // a generic transport AbortError.
            const transport = describeTransport();
            reject(new Error(message + (!reasoningReceived && provider === "ollama"
                ? " Local model loading and prompt/image processing can also cause this delay." : "")
                + (transport ? ` ${transport}` : "")));
            abort();
        }, timeoutMs);
    });
    return {
        promise,
        noteReasoning() { reasoningReceived = true; },
        clear() { clearTimeout(timer); },
    };
}
