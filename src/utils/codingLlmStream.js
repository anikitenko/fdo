// Preserve SSE framing across arbitrary network chunks. The provider adapter
// still converts each complete event into content/usage chunks.
export async function* readCodingStreamEvents(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let data = [];
    const parseLine = (line) => {
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
            const value = data.join("\n");
            data = [];
            if (!value || value === "[DONE]") return null;
            return JSON.parse(value);
        }
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        return null;
    };
    try {
        while (true) {
            const {value, done} = await reader.read();
            pending += done ? decoder.decode() : decoder.decode(value, {stream: true});
            let end;
            while ((end = pending.indexOf("\n")) !== -1) {
                const event = parseLine(pending.slice(0, end));
                pending = pending.slice(end + 1);
                if (event) yield event;
            }
            if (done) break;
        }
        if (pending) parseLine(pending);
        const last = parseLine("");
        if (last) yield last;
    } finally {
        try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
}

export async function* codingStreamResponses(body, parsers) {
    const buffers = {type: "buffers"};
    let completed = false;
    for await (const event of readCodingStreamEvents(body)) {
        if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
            const response = event.response;
            const reason = response?.error?.message || event.error?.message || event.message
                || response?.incomplete_details?.reason || event.type;
            throw new Error(`Assistant stream ${event.type}: ${reason}`);
        }
        for (const [type, parse] of Object.entries(parsers)) {
            const content = parse(event);
            if (!content || (Array.isArray(content) && !content.length)) continue;
            if (type === "usage") buffers[type] = content;
            else if (Array.isArray(content)) buffers[type] = [...(buffers[type] || []), ...content];
            else buffers[type] = (buffers[type] || "") + content;
            yield {type, content};
        }
        if (event.type === "response.completed" || event.type === "message_stop" || event.done) {
            completed = true;
            break;
        }
    }
    if (this.service === "openai" && !completed) {
        throw new Error("Assistant stream ended before response.completed; no changes were applied.");
    }
    this.saveBuffers(buffers);
    return buffers;
}
