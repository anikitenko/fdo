// Preserve SSE framing across arbitrary network chunks. The provider adapter
// still converts each complete event into content/usage chunks.
export const CODING_STREAM_DONE = Symbol("coding-stream-done");

export async function* readCodingStreamEvents(body, {includeDone = false, onEvent} = {}) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let data = [];
    let eventName = "";
    const parseLine = (line) => {
        if (line === "") {
            const value = data.join("\n");
            const name = eventName;
            data = [];
            eventName = "";
            if (!value) return null;
            if (value === "[DONE]") return CODING_STREAM_DONE;
            const event = JSON.parse(value);
            onEvent?.(event, name);
            return event;
        }
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        if (line.startsWith("event:")) eventName = line.slice(6).replace(/^ /, "");
        return null;
    };
    try {
        while (true) {
            let chunk;
            try { chunk = await reader.read(); }
            catch (cause) {
                // Classify only failures from the stream read, never text in
                // provider events or JSON parsing. Fetch/Undici uses this
                // TypeError when a response body is interrupted mid-transfer.
                const chain = [];
                for (let error = cause; error && chain.length < 8 && !chain.includes(error); error = error.cause) chain.push(error);
                const aborted = chain.some(error => ['AbortError', 'APIUserAbortError'].includes(error.name)
                    || ['ABORT_ERR', 'ERR_ABORTED'].includes(error.code) || error.retryable === false);
                const transport = chain.some(error => ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'UND_ERR_BODY_TIMEOUT'].includes(error.code))
                    || cause?.name === 'TypeError' && cause.message === 'terminated';
                if (!aborted && transport) throw Object.assign(new Error('Assistant response stream was interrupted before completion. No partial file was accepted.', {cause}),
                    {code: 'stream_incomplete'});
                throw cause;
            }
            const {value, done} = chunk;
            pending += done ? decoder.decode() : decoder.decode(value, {stream: true});
            let end;
            while ((end = pending.search(/[\r\n]/)) !== -1) {
                // A CRLF pair can be split between network chunks. Do not
                // misread its LF as an extra empty line / event separator.
                if (!done && pending[end] === "\r" && end === pending.length - 1) break;
                const width = pending[end] === "\r" && pending[end + 1] === "\n" ? 2 : 1;
                const event = parseLine(pending.slice(0, end));
                pending = pending.slice(end + width);
                if (event === CODING_STREAM_DONE) {
                    if (includeDone) yield event;
                    return;
                }
                if (event !== null) yield event;
            }
            if (done) break;
        }
        if (pending) parseLine(pending);
        const last = parseLine("");
        if (last === CODING_STREAM_DONE) {
            if (includeDone) yield last;
        } else if (last !== null) yield last;
    } finally {
        // An errored reader can reject cancel() with the same socket error.
        // Cleanup must not replace the original failure or a completed result.
        try { await reader.cancel(); } catch { /* Best-effort cleanup. */ }
        try { reader.releaseLock(); } catch { /* Preserve the primary outcome. */ }
    }
}
