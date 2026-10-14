import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Agent, JsonlLocalAgentStore} from '@cursor/sdk';
import {completion} from './messages';
import {inspectCursorModel} from './cursorProvider';

// Official API-key SDK, running in process. No CLI, external tools, ambient
// Cursor extensions, or access to the user's plugin files. FDO supplies context
// and validates all returned proposals before applying changes.
export async function* cursorRequest(config, conversation, options, signal) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-cursor-'));
    let agent, run;
    let cancellation;
    const abort = () => {cancellation = run?.cancel().catch(() => {}); agent?.close();};
    const checkCancelled = () => {if (signal.aborted) throw new DOMException('Cursor request was cancelled.', 'AbortError');};
    const waitFor = (work, onLate) => new Promise((resolve, reject) => {
        let cancelled = false;
        const stop = () => {cancelled = true; reject(new DOMException('Cursor request was cancelled.', 'AbortError'));};
        signal.addEventListener('abort', stop, {once: true});
        if (signal.aborted) stop();
        Promise.resolve(work).then(value => {
            signal.removeEventListener('abort', stop);
            if (cancelled) Promise.resolve(onLate?.(value)).catch(() => {});
            else resolve(value);
        }, error => {signal.removeEventListener('abort', stop); if (!cancelled) reject(error);});
    });
    signal.addEventListener('abort', abort, {once: true});
    try {
        checkCancelled();
        const images = conversation.messages.flatMap(message => message.attachments || []).map(attachment => {
            if (!attachment.mediaType?.startsWith('image/')) throw new Error('Cursor image requests require image attachments.');
            if (attachment.url) {
                if (!/^https?:\/\//i.test(attachment.url)) throw new Error('Cursor remote images require an HTTP or HTTPS URL. Upload local images instead.');
                return {url: attachment.url};
            }
            if (typeof attachment.data !== 'string' || !attachment.data.trim()) throw new Error('Cursor image attachment has no base64 data.');
            return {data: attachment.data, mimeType: attachment.mediaType};
        });
        config.onRequestStarted?.();
        const model = await waitFor(inspectCursorModel({apiKey: config.apiKey, model: options.model}));
        checkCancelled();
        // SDK assistant events contain complete message segments, so generation
        // may be buffered between them even when the stream is open.
        yield {type: 'response-mode', mode: 'buffered'};
        agent = await waitFor(Agent.create({apiKey: config.apiKey, model: model.modelMetadata.selection, tools: [],
            disallowedTools: ['mcp', 'task'], mcpServers: {}, agents: {},
            local: {cwd: root, store: new JsonlLocalAgentStore(path.join(root, 'state')),
                settingSources: [], enableAgentRetries: false},
        }), async lateAgent => {
            try {await lateAgent[Symbol.asyncDispose]();}
            finally {await fs.rm(root, {recursive: true, force: true});}
        });
        checkCancelled();
        const prompt = [conversation.system,
            ...conversation.messages.map(message => `${message.role.toUpperCase()}:\n${message.content}`),
            ...(options.responseSchema ? [`Return only JSON matching this response schema; FDO validates the result locally:\n${JSON.stringify(options.responseSchema)}`] : []),
        ].filter(Boolean).join('\n\n');
        run = await waitFor(agent.send(images.length ? {text: prompt, images} : prompt), lateRun => lateRun.cancel());
        checkCancelled();
        let text = '';
        for await (const event of run.stream()) {
            checkCancelled();
            config.onResponseStarted?.();
            if (event.type === 'thinking') yield {type: 'thinking', content: event.text || ''};
            else if (event.type === 'assistant') {
                for (const block of event.message.content) {
                    if (block.type === 'tool_use') throw new Error('Cursor returned a tool call despite the disabled toolset. No tool is authorized in this integration.');
                    if (block.type === 'text') {text += block.text; yield {type: 'content', content: block.text};}
                }
            } else if (event.type === 'tool_call') throw new Error('Cursor attempted a tool call despite the disabled toolset.');
        }
        const result = await run.wait();
        checkCancelled();
        if (result.status !== 'finished') throw Object.assign(new Error(result.error?.message || `Cursor run ${result.status}.`), {code: result.error?.code});
        const finalText = result.result ?? text;
        if (!text && finalText) yield {type: 'content', content: finalText};
        const usage = result.usage ? {
            input_tokens: result.usage.inputTokens == null ? undefined : result.usage.inputTokens
                + (result.usage.cacheReadTokens || 0) + (result.usage.cacheWriteTokens || 0),
            output_tokens: result.usage.outputTokens,
            total_tokens: result.usage.totalTokens, cached_input_tokens: result.usage.cacheReadTokens,
            cache_write_tokens: result.usage.cacheWriteTokens,
            ...(result.usage.reasoningTokens != null ? {reasoning_tokens: result.usage.reasoningTokens} : {}),
        } : undefined;
        yield completion(finalText, [], usage, 'completed');
    } finally {
        signal.removeEventListener('abort', abort);
        try {
            if (run?.status === 'running') await run.cancel().catch(() => {});
            if (agent?.[Symbol.asyncDispose]) await agent[Symbol.asyncDispose]();
            else agent?.close();
            await cancellation;
        } finally {await fs.rm(root, {recursive: true, force: true});}
    }
}
