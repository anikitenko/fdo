import { ipcMain } from "electron";
import { AiCodingAgentChannels } from "./channels.js";
import LLM from "@themaximalist/llm.js";
import { settings } from "../utils/store.js";
import crypto from "crypto";

// Select a coding assistant from settings
function selectCodingAssistant(assistantId) {
    const list = settings.get("ai.coding", []) || [];
    
    // If assistantId is provided, find that specific assistant
    if (assistantId) {
        const assistant = list.find(a => a.id === assistantId);
        if (assistant) return assistant;
    }
    
    // Otherwise, fall back to default or first
    const assistantInfo = list.find(a => a.default) || list[0];
    if (!assistantInfo) {
        throw new Error("No AI Coding assistant found. Please add one in Settings → AI Assistants.");
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

### FDO Plugin Development Context

When working with FDO plugins, be aware of:

**FDO SDK (@anikitenko/fdo-sdk)**
- Plugins extend the FDO_SDK base class and implement FDOInterface
- Required metadata: name, version, author, description, icon
- Lifecycle hooks: init() for initialization, render() for UI rendering
- Communication: IPC message-based communication with main application
- Storage: Multiple backends (in-memory, JSON file-based)
- Logging: Built-in this.log() method

**DOM Element Generation**
The SDK provides specialized classes for creating HTML elements:
- DOMTable: Tables with thead, tbody, tfoot, tr, th, td, caption
- DOMMedia: Images with accessibility support
- DOMSemantic: article, section, nav, header, footer, aside, main
- DOMNested: Ordered lists (ol), definition lists (dl, dt, dd)
- DOMInput: Form inputs, select dropdowns with options
- DOMText: Headings, paragraphs, spans
- DOMButton: Buttons with event handlers
- DOMLink: Anchor elements
- DOMMisc: Horizontal rules and other elements

All DOM classes support:
- Custom CSS styling via goober CSS-in-JS
- Custom classes and inline styles
- HTML attributes
- Event handlers
- Accessibility attributes

**Example Plugin Structure:**
\`\`\`typescript
import { FDO_SDK, FDOInterface, PluginMetadata } from "@anikitenko/fdo-sdk";

export default class MyPlugin extends FDO_SDK implements FDOInterface {
    private readonly _metadata: PluginMetadata = {
        name: "My Plugin",
        version: "1.0.0",
        author: "Your Name",
        description: "Plugin description",
        icon: "COG"
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }

    init(): void {
        this.log("Plugin initialized!");
    }

    render(): string {
        return "<div>Hello World</div>";
    }
}
\`\`\`

### Guidelines:
1. Provide clean, production-ready code that follows best practices
2. When generating FDO plugins, use the SDK's DOM classes for better type safety
3. When generating code, match the style and patterns of the surrounding code
4. When editing code, make minimal changes to achieve the desired result
5. When explaining code, be concise but thorough
6. When fixing bugs, explain what was wrong and how you fixed it
7. Always consider the context of the file being edited (language, framework, etc.)
8. Format your responses appropriately:
   - For code generation/editing: return ONLY the code without explanations unless asked
   - For explanations: provide clear, structured explanations
   - For fixes: include both the fix and a brief explanation

Remember: You are working within a code editor, so precision and correctness are paramount.
`);

    return llm;
}

// Handle code generation
async function handleGenerateCode(event, data) {
    const { prompt, language, context, assistantId } = data;
    const requestId = crypto.randomUUID();

    console.log('[AI Coding Agent Backend] Generate code request', { requestId, language, promptLength: prompt?.length, assistantId });

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        console.log('[AI Coding Agent Backend] Assistant selected', { name: assistantInfo.name, provider: assistantInfo.provider, model: assistantInfo.model });
        
        const llm = await createCodingLlm(assistantInfo, true);

        let fullPrompt = `Generate ${language || "code"} for the following request:\n\n${prompt}`;
        
        if (context) {
            fullPrompt += `\n\nContext:\n${context}`;
        }

        llm.user(fullPrompt);
        console.log('[AI Coding Agent Backend] Sending to LLM');
        const resp = await llm.chat({ stream: true });

        let fullContent = "";

        if (resp && typeof resp === "object" && "stream" in resp && typeof resp.complete === "function") {
            console.log('[AI Coding Agent Backend] Streaming started');
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
            console.log('[AI Coding Agent Backend] Streaming complete', { requestId, contentLength: fullContent.length });
            event.sender.send(AiCodingAgentChannels.on_off.STREAM_DONE, { requestId, fullContent });
            return { success: true, requestId, content: fullContent };
        }

        console.error('[AI Coding Agent Backend] Invalid LLM response');
        return { success: false, error: "Invalid response from LLM" };
    } catch (error) {
        console.error('[AI Coding Agent Backend] Error in handleGenerateCode', error);
        event.sender.send(AiCodingAgentChannels.on_off.STREAM_ERROR, {
            requestId,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}

// Handle code editing
async function handleEditCode(event, data) {
    const { code, instruction, language, assistantId } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
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
    const { code, language, assistantId } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
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
    const { code, error, language, assistantId } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
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

// Handle smart mode - AI determines the action
async function handleSmartMode(event, data) {
    const { prompt, code, language, context, assistantId } = data;
    const requestId = crypto.randomUUID();

    try {
        const assistantInfo = selectCodingAssistant(assistantId);
        const llm = await createCodingLlm(assistantInfo, true);

        // Build context for the AI to understand what's available
        let fullPrompt = `You are a coding assistant. Analyze the user's request and provide the appropriate response.

User's request: ${prompt}

`;

        if (code) {
            fullPrompt += `Selected code (${language || 'unknown language'}):\n\`\`\`\n${code}\n\`\`\`\n\n`;
        }

        if (context && !code) {
            fullPrompt += `Current file context:\n\`\`\`\n${context}\n\`\`\`\n\n`;
        }

        fullPrompt += `Based on the request and available context, determine the appropriate action and provide your response:
- If generating new code: Provide the code
- If editing existing code: Provide the modified version
- If explaining code: Provide a clear explanation
- If fixing code: Provide the corrected code with explanation

Provide ONLY the relevant output without meta-commentary about which action you chose.`;

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

export function registerAiCodingAgentHandlers() {
    ipcMain.handle(AiCodingAgentChannels.GENERATE_CODE, handleGenerateCode);
    ipcMain.handle(AiCodingAgentChannels.EDIT_CODE, handleEditCode);
    ipcMain.handle(AiCodingAgentChannels.EXPLAIN_CODE, handleExplainCode);
    ipcMain.handle(AiCodingAgentChannels.FIX_CODE, handleFixCode);
    ipcMain.handle(AiCodingAgentChannels.SMART_MODE, handleSmartMode);
}
