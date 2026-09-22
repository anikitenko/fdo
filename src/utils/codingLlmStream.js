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
            const {value, done} = await reader.read();
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
        try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
}
