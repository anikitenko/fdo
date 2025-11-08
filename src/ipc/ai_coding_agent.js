import { ipcMain } from "electron";
import { AiCodingAgentChannels } from "./channels.js";
import LLM from "@themaximalist/llm.js";
import { settings } from "../utils/store.js";
import crypto from "crypto";

// Select a coding assistant from settings
function selectCodingAssistant() {
    const list = settings.get("ai.coding", []) || [];
    const assistantInfo = list.find(a => a.default) || list[0];
    if (!assistantInfo) {
        throw new Error("No AI Coding assistant found. Please add one in Settings.");
    }
    return assistantInfo;
}

// Create LLM instance for coding tasks
async function createCodingLlm(assistantInfo, stream = false) {
    const llm = new LLM({
        service: assistantInfo.provider,
        apiKey: assistantInfo.apiKey,
        model: assistantInfo.model,
        stream: stream,
        extended: true,
        max_tokens: 4096,
    });

    llm.system(`
You are an expert coding assistant integrated into the FDO (FlexDevOps) code editor.

Your role is to help developers with:
- Code generation based on natural language descriptions
- Code editing and refactoring
- Code explanation and documentation
- Bug fixing and error resolution

Guidelines:
1. Provide clean, production-ready code that follows best practices
2. When generating code, match the style and patterns of the surrounding code
3. When editing code, make minimal changes to achieve the desired result
4. When explaining code, be concise but thorough
5. When fixing bugs, explain what was wrong and how you fixed it
6. Always consider the context of the file being edited (language, framework, etc.)
7. Format your responses appropriately:
   - For code generation/editing: return ONLY the code without explanations unless asked
   - For explanations: provide clear, structured explanations
   - For fixes: include both the fix and a brief explanation

Remember: You are working within a code editor, so precision and correctness are paramount.
`);

    return llm;
}

// Handle code generation
async function handleGenerateCode(event, data) {
    const { prompt, language, context } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant();
        const llm = await createCodingLlm(assistantInfo, true);

        let fullPrompt = `Generate ${language || "code"} for the following request:\n\n${prompt}`;
        
        if (context) {
            fullPrompt += `\n\nContext:\n${context}`;
        }

        llm.user(fullPrompt);
        const resp = await llm.chat({ stream: true });

        let fullContent = "";

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            for await (const chunk of resp.stream) {
                if (!chunk) continue;
                const { type, content: piece } = chunk;

                if (type === "content" && piece && typeof piece === "string") {
                    fullContent += piece;
                    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                        requestId,
                        type: "content",
                        content: piece,
                    });
                }
            }

            await resp.complete();
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        return { success: false, error: "Invalid response from LLM" };
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code editing
async function handleEditCode(event, data) {
    const { code, instruction, language } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant();
        const llm = await createCodingLlm(assistantInfo, true);

        const prompt = `Edit the following ${language || ""} code according to this instruction: ${instruction}

Original code:
\`\`\`${language || ""}
${code}
\`\`\`

Provide ONLY the modified code without additional explanations.`;

        llm.user(prompt);
        const resp = await llm.chat({ stream: true });

        let fullContent = "";

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            for await (const chunk of resp.stream) {
                if (!chunk) continue;
                const { type, content: piece } = chunk;

                if (type === "content" && piece && typeof piece === "string") {
                    fullContent += piece;
                    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                        requestId,
                        type: "content",
                        content: piece,
                    });
                }
            }

            await resp.complete();
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        return { success: false, error: "Invalid response from LLM" };
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code explanation
async function handleExplainCode(event, data) {
    const { code, language } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant();
        const llm = await createCodingLlm(assistantInfo, true);

        const prompt = `Explain the following ${language || ""} code:

\`\`\`${language || ""}
${code}
\`\`\`

Provide a clear, concise explanation of what this code does, how it works, and any notable patterns or practices used.`;

        llm.user(prompt);
        const resp = await llm.chat({ stream: true });

        let fullContent = "";

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            for await (const chunk of resp.stream) {
                if (!chunk) continue;
                const { type, content: piece } = chunk;

                if (type === "content" && piece && typeof piece === "string") {
                    fullContent += piece;
                    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                        requestId,
                        type: "content",
                        content: piece,
                    });
                }
            }

            await resp.complete();
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        return { success: false, error: "Invalid response from LLM" };
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code fixing
async function handleFixCode(event, data) {
    const { code, error, language } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant();
        const llm = await createCodingLlm(assistantInfo, true);

        const prompt = `Fix the following ${language || ""} code that has this error: ${error}

Code with error:
\`\`\`${language || ""}
${code}
\`\`\`

Provide the fixed code and a brief explanation of what was wrong and how you fixed it.`;

        llm.user(prompt);
        const resp = await llm.chat({ stream: true });

        let fullContent = "";

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            for await (const chunk of resp.stream) {
                if (!chunk) continue;
                const { type, content: piece } = chunk;

                if (type === "content" && piece && typeof piece === "string") {
                    fullContent += piece;
                    event.sender.send(AiCodingAgentChannels.on_off.STREAM_DELTA, {
                        requestId,
                        type: "content",
                        content: piece,
                    });
                }
            }

            await resp.complete();
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        return { success: false, error: "Invalid response from LLM" };
    } catch (error) {
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

export function registerAiCodingAgentHandlers() {
    ipcMain.handle(AiCodingAgentChannels.GENERATE_CODE, handleGenerateCode);
    ipcMain.handle(AiCodingAgentChannels.EDIT_CODE, handleEditCode);
    ipcMain.handle(AiCodingAgentChannels.EXPLAIN_CODE, handleExplainCode);
    ipcMain.handle(AiCodingAgentChannels.FIX_CODE, handleFixCode);
}
