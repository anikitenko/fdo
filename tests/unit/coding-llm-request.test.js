import LLM from "@themaximalist/llm.js";
import {ReadableStream} from "node:stream/web";
import {TextEncoder, TextDecoder} from "node:util";
import {sendCodingLlmRequest} from "../../src/utils/codingLlmRequest";

describe("coding request with the installed LLM provider adapter", () => {
    const originalFetch = global.fetch;
    const originalDecoder = global.TextDecoder;
    beforeEach(() => { global.TextDecoder = TextDecoder; });
    afterEach(() => { global.fetch = originalFetch; global.TextDecoder = originalDecoder; });

    test.each([null, "data:image/png;base64,aGVsbG8="])("sends the prompt and attachment using provider-native input: %s", async (image) => {
        let payload;
        global.fetch = jest.fn(async (_url, options) => {
            payload = JSON.parse(options.body);
            return {ok: true, body: new ReadableStream({start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Quasar Quill"}\n\ndata: {"type":"response.completed","response":{}}\n\n'));
                controller.close();
            }})};
        });
        const llm = new LLM({service: "openai", model: "gpt-5.6", apiKey: "test-only", stream: true, extended: true, max_tokens: 4096});
        llm.system("Plugin workspace only.");
        const response = await sendCodingLlmRequest(llm, "Rename the plugin to Quasar Quill", image);
        let text = "";
        for await (const chunk of response.stream) {
            if (chunk.type === "content") text += chunk.content;
        }
        await response.complete();
        expect(text).toBe("Quasar Quill");
        expect(payload.input).toHaveLength(2);
        expect(payload.input[0]).toEqual({role: "system", content: "Plugin workspace only."});
        expect(payload.input[1]).toEqual({role: "user", content: image ? [
            {type: "input_image", image_url: image},
            {type: "input_text", text: "Rename the plugin to Quasar Quill"},
        ] : "Rename the plugin to Quasar Quill"});
        expect(payload.max_output_tokens).toBe(4096);
    });
});
