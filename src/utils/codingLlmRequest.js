import LLM from "@themaximalist/llm.js";
import {codingStreamResponses} from "./codingLlmStream";

export function sendCodingLlmRequest(llm, prompt, image = null) {
    if (["openai", "anthropic"].includes(llm.service)) {
        llm.streamResponses = codingStreamResponses.bind(llm);
    }
    const attachments = [];
    if (image) {
        const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(image);
        if (!match) throw new Error("Expected a base64 image attachment.");
        attachments.push(LLM.Attachment.fromBase64(match[2], "image", match[1]));
    }
    // chat's first argument is message text; request options belong second.
    return llm.chat(prompt, {stream: true, attachments});
}
