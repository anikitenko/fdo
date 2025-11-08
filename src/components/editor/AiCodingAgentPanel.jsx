import React, { useState, useEffect, useRef } from "react";
import {
    Button,
    Card,
    TextArea,
    FormGroup,
    HTMLSelect,
    Tag,
    Spinner,
    NonIdealState,
    Switch,
    Callout,
} from "@blueprintjs/core";
import * as styles from "./AiCodingAgentPanel.module.css";
import Markdown from "markdown-to-jsx";
import virtualFS from "./utils/VirtualFS";

const AI_ACTIONS = [
    { label: "Smart Mode (AI decides)", value: "smart" },
    { label: "Generate Code", value: "generate" },
    { label: "Edit Code", value: "edit" },
    { label: "Explain Code", value: "explain" },
    { label: "Fix Code", value: "fix" },
];

export default function AiCodingAgentPanel({ codeEditor, editorModelPath }) {
    const [action, setAction] = useState("smart");
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [response, setResponse] = useState("");
    const [error, setError] = useState(null);
    const [streamingRequestId, setStreamingRequestId] = useState(null);
    const [autoApply, setAutoApply] = useState(false);
    const [assistants, setAssistants] = useState([]);
    const [selectedAssistant, setSelectedAssistant] = useState(null);
    const [loadingAssistants, setLoadingAssistants] = useState(true);
    const [sdkTypes, setSdkTypes] = useState(null);
    const responseRef = useRef("");

    // Load SDK types on mount
    useEffect(() => {
        async function loadSdkTypes() {
            try {
                const types = await window.electron.system.getFdoSdkTypes();
                setSdkTypes(types);
                console.log('[AI Coding Agent] SDK types loaded', { filesCount: types ? types.length : 0 });
            } catch (err) {
                console.error('[AI Coding Agent] Failed to load SDK types', err);
            }
        }
        loadSdkTypes();
    }, []);

    // Load available coding assistants
    useEffect(() => {
        async function loadAssistants() {
            try {
                setLoadingAssistants(true);
                const allAssistants = await window.electron.settings.ai.getAssistants();
                const codingAssistants = allAssistants.filter(a => a.purpose === 'coding');
                setAssistants(codingAssistants);
                
                // Select default or first assistant
                const defaultAssistant = codingAssistants.find(a => a.default);
                setSelectedAssistant(defaultAssistant || codingAssistants[0] || null);
            } catch (err) {
                console.error('Failed to load assistants:', err);
                setError('Failed to load AI assistants. Please check your settings.');
            } finally {
                setLoadingAssistants(false);
            }
        }
        loadAssistants();
    }, []);

    useEffect(() => {
        const handleStreamDelta = (data) => {
            console.log('[AI Coding Agent] Stream delta received', { requestId: data.requestId, contentLength: data.content ? data.content.length : 0 });
            if (data.requestId === streamingRequestId && data.type === "content") {
                responseRef.current += data.content;
                setResponse(responseRef.current);
            }
        };

        const handleStreamDone = (data) => {
            console.log('[AI Coding Agent] Stream done', { requestId: data.requestId });
            if (data.requestId === streamingRequestId) {
                setIsLoading(false);
                setStreamingRequestId(null);
                
                // Auto-apply if enabled
                if (autoApply && responseRef.current) {
                    autoInsertCodeIntoEditor();
                }
            }
        };

        const handleStreamError = (data) => {
            console.error('[AI Coding Agent] Stream error', data);
            if (data.requestId === streamingRequestId) {
                setError(data.error);
                setIsLoading(false);
                setStreamingRequestId(null);
            }
        };

        window.electron.aiCodingAgent.on.streamDelta(handleStreamDelta);
        window.electron.aiCodingAgent.on.streamDone(handleStreamDone);
        window.electron.aiCodingAgent.on.streamError(handleStreamError);

        return () => {
            window.electron.aiCodingAgent.off.streamDelta(handleStreamDelta);
            window.electron.aiCodingAgent.off.streamDone(handleStreamDone);
            window.electron.aiCodingAgent.off.streamError(handleStreamError);
        };
    }, [streamingRequestId, autoApply]);

    const getSelectedCode = () => {
        if (!codeEditor) return "";
        const selection = codeEditor.getSelection();
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getValueInRange(selection);
    };

    const getLanguage = () => {
        if (!codeEditor) return "";
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getLanguageId();
    };

    const getContext = () => {
        if (!codeEditor) return "";
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getValue();
    };

    const getAllProjectFiles = () => {
        try {
            const models = virtualFS.listModels();
            const files = models.map(model => {
                const uri = model.uri.toString(true).replace("file://", "");
                // Skip node_modules and dist
                if (uri.includes("/node_modules/") || uri.includes("/dist/")) {
                    return null;
                }
                return {
                    path: uri,
                    content: model.getValue()
                };
            }).filter(Boolean);
            
            return files;
        } catch (err) {
            console.error('[AI Coding Agent] Error getting project files', err);
            return [];
        }
    };

    const buildProjectContext = (selectedCode, language, currentFileContext) => {
        const projectFiles = getAllProjectFiles();
        let context = '';

        // Add SDK types reference
        if (sdkTypes && sdkTypes.length > 0) {
            context += `FDO SDK Type Definitions (for reference):\n`;
            sdkTypes.forEach(file => {
                // Include full SDK types as they contain comprehensive documentation
                context += `\nSDK File: ${file.name}\n\`\`\`typescript\n${file.content}\n\`\`\`\n`;
            });
            context += `\n---\n\n`;
        }

        if (currentFileContext) {
            context += `Current file:\n\`\`\`${language}\n${currentFileContext}\n\`\`\`\n\n`;
        }

        if (selectedCode) {
            context += `Selected code:\n\`\`\`${language}\n${selectedCode}\n\`\`\`\n\n`;
        }

        if (projectFiles.length > 0) {
            context += `Project files (${projectFiles.length} files):\n`;
            projectFiles.forEach(file => {
                // Limit file content to first 500 chars to avoid token limits
                const preview = file.content.length > 500 
                    ? file.content.substring(0, 500) + '...'
                    : file.content;
                context += `\nFile: ${file.path}\n\`\`\`\n${preview}\n\`\`\`\n`;
            });
        }

        return context;
    };

    const createSnapshotBeforeApply = () => {
        try {
            const currentVersion = virtualFS.fs.version();
            const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({id: t.id, active: t.active}));
            const created = virtualFS.fs.create(currentVersion.version, tabs);
            console.log(`Created snapshot ${created.version} before AI code application`);
            return created;
        } catch (err) {
            console.error('Failed to create snapshot:', err);
            return null;
        }
    };

    const autoInsertCodeIntoEditor = () => {
        // Create snapshot before applying changes
        const snapshot = createSnapshotBeforeApply();
        if (!snapshot && autoApply) {
            setError('Failed to create snapshot before applying changes');
            return;
        }
        
        insertCodeIntoEditor();
    };

    const handleSubmit = async () => {
        if (!prompt.trim()) return;
        
        // Validate assistant is selected
        if (!selectedAssistant) {
            setError("No coding assistant selected. Please select one from the dropdown or add one in Settings.");
            return;
        }

        console.log('[AI Coding Agent] Submit started', { action, prompt: prompt.substring(0, 50) });
        setIsLoading(true);
        setError(null);
        setResponse("");
        responseRef.current = "";

        // Set a safety timeout to prevent hanging forever
        const timeoutId = setTimeout(() => {
            if (isLoading) {
                console.error('[AI Coding Agent] Request timeout after 60s');
                setError("Request timed out. The AI service may be unavailable. Please try again.");
                setIsLoading(false);
                setStreamingRequestId(null);
            }
        }, 60000); // 60 second timeout

        try {
            const selectedCode = getSelectedCode();
            const language = getLanguage();
            const currentFileContext = getContext();
            
            // Build comprehensive project context for smart mode
            const enhancedContext = action === "smart" 
                ? buildProjectContext(selectedCode, language, currentFileContext)
                : (action === "generate" ? currentFileContext : "");

            console.log('[AI Coding Agent] Preparing request', { 
                action, 
                hasCode: !!selectedCode, 
                language,
                contextLength: enhancedContext.length
            });

            let result;
            switch (action) {
                case "smart":
                    result = await window.electron.aiCodingAgent.smartMode({
                        prompt,
                        code: selectedCode,
                        language,
                        context: enhancedContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "generate":
                    result = await window.electron.aiCodingAgent.generateCode({
                        prompt,
                        language,
                        context: enhancedContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "edit":
                    if (!selectedCode) {
                        setError("Please select code to edit");
                        setIsLoading(false);
                        clearTimeout(timeoutId);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.editCode({
                        code: selectedCode,
                        instruction: prompt,
                        language,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "explain":
                    if (!selectedCode) {
                        setError("Please select code to explain");
                        setIsLoading(false);
                        clearTimeout(timeoutId);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.explainCode({
                        code: selectedCode,
                        language,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "fix":
                    if (!selectedCode) {
                        setError("Please select code to fix");
                        setIsLoading(false);
                        clearTimeout(timeoutId);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.fixCode({
                        code: selectedCode,
                        error: prompt,
                        language,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                default:
                    break;
            }

            console.log('[AI Coding Agent] IPC result received', result);

            if (result && result.requestId) {
                console.log('[AI Coding Agent] Streaming started', result.requestId);
                setStreamingRequestId(result.requestId);
            } else if (result && result.error) {
                console.error('[AI Coding Agent] Error in result', result.error);
                setError(result.error);
                setIsLoading(false);
                clearTimeout(timeoutId);
            } else {
                console.error('[AI Coding Agent] Invalid result', result);
                setError("Invalid response from AI service. Please try again.");
                setIsLoading(false);
                clearTimeout(timeoutId);
            }
        } catch (err) {
            console.error('[AI Coding Agent] Exception in handleSubmit', err);
            setError(err.message || "An error occurred");
            setIsLoading(false);
            clearTimeout(timeoutId);
        }
    };

    const insertCodeIntoEditor = () => {
        if (!codeEditor || !response) return;

        const selection = codeEditor.getSelection();
        const model = codeEditor.getModel();
        if (!model) return;

        // Extract code from markdown code blocks if present
        const codeBlockMatch = response.match(/```[\w]*\n([\s\S]*?)\n```/);
        const codeToInsert = codeBlockMatch ? codeBlockMatch[1] : response;

        const edit = {
            range: selection,
            text: codeToInsert,
            forceMoveMarkers: true,
        };

        model.pushEditOperations([], [edit], () => null);
        codeEditor.focus();
    };

    const clearResponse = () => {
        setResponse("");
        responseRef.current = "";
        setError(null);
    };

    // Show loading state while fetching assistants
    if (loadingAssistants) {
        return (
            <div className={styles["ai-coding-agent-panel"]}>
                <div className={styles["panel-content"]}>
                    <NonIdealState
                        icon={<Spinner size={40} />}
                        title="Loading AI Assistants"
                        description="Please wait..."
                    />
                </div>
            </div>
        );
    }

    // Show message if no assistants available
    if (assistants.length === 0) {
        return (
            <div className={styles["ai-coding-agent-panel"]}>
                <div className={styles["panel-content"]}>
                    <NonIdealState
                        icon="warning-sign"
                        title="No Coding Assistants Available"
                        description={
                            <div>
                                <p>No AI coding assistants found.</p>
                                <p>Please add a coding assistant in Settings → AI Assistants.</p>
                            </div>
                        }
                    />
                </div>
            </div>
        );
    }

    return (
        <div className={styles["ai-coding-agent-panel"]}>
            <div className={styles["panel-header"]}>
                <h3>AI Coding Agent</h3>
                <Tag minimal intent="primary">
                    Beta
                </Tag>
            </div>

            <div className={styles["panel-content"]}>
                <FormGroup label="AI Assistant" labelFor="assistant-select">
                    <HTMLSelect
                        id="assistant-select"
                        value={selectedAssistant?.id || ""}
                        onChange={(e) => {
                            const assistant = assistants.find(a => a.id === e.target.value);
                            setSelectedAssistant(assistant);
                        }}
                        fill
                    >
                        {assistants.map(assistant => (
                            <option key={assistant.id} value={assistant.id}>
                                {assistant.name} ({assistant.provider} - {assistant.model})
                                {assistant.default ? ' ★' : ''}
                            </option>
                        ))}
                    </HTMLSelect>
                </FormGroup>

                <FormGroup label="Action" labelFor="action-select">
                    <HTMLSelect
                        id="action-select"
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        options={AI_ACTIONS}
                        fill
                    />
                </FormGroup>

                <FormGroup
                    label={
                        action === "smart"
                            ? "Describe what you want to do"
                            : action === "generate"
                            ? "Describe what you want to generate"
                            : action === "edit"
                            ? "Describe how to edit the selected code"
                            : action === "explain"
                            ? "What would you like to know? (optional)"
                            : "Describe the error (optional)"
                    }
                    labelFor="prompt-input"
                >
                    <TextArea
                        id="prompt-input"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={
                            action === "smart"
                                ? "e.g., Add error handling to this function, or Create a validation function, or Explain this algorithm"
                                : action === "generate"
                                ? "e.g., Create a function that validates email addresses"
                                : action === "edit"
                                ? "e.g., Add error handling and logging"
                                : action === "explain"
                                ? "e.g., Focus on the algorithm used"
                                : "e.g., TypeError on line 42"
                        }
                        fill
                        rows={4}
                        disabled={isLoading}
                    />
                </FormGroup>

                <FormGroup>
                    <Switch
                        checked={autoApply}
                        label="Auto-apply changes (creates snapshot first)"
                        onChange={(e) => setAutoApply(e.target.checked)}
                        disabled={isLoading}
                    />
                    {autoApply && (
                        <Callout intent="primary" style={{ marginTop: '8px', fontSize: '12px' }}>
                            Changes will be automatically applied after AI response. A snapshot will be created before each application.
                        </Callout>
                    )}
                </FormGroup>

                <div className={styles["action-buttons"]}>
                    <Button
                        intent="primary"
                        text={isLoading ? "Processing..." : "Submit"}
                        icon={isLoading ? <Spinner size={16} /> : "send-message"}
                        onClick={handleSubmit}
                        disabled={isLoading || !prompt.trim() || !selectedAssistant}
                        fill
                    />
                    {response && !autoApply && (
                        <Button
                            text="Insert into Editor"
                            icon="insert"
                            onClick={insertCodeIntoEditor}
                            disabled={isLoading}
                        />
                    )}
                    {response && (
                        <Button
                            text="Clear"
                            icon="cross"
                            onClick={clearResponse}
                            disabled={isLoading}
                        />
                    )}
                </div>

                {error && (
                    <div className={styles["error-message"]}>
                        <Tag intent="danger" fill>
                            {error}
                        </Tag>
                    </div>
                )}

                {isLoading && !response && (
                    <div className={styles["loading-indicator"]}>
                        <Callout intent="primary" icon={<Spinner size={20} />}>
                            <strong>Processing your request...</strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>
                                The AI is analyzing your prompt and generating a response. This may take a few moments.
                            </p>
                        </Callout>
                    </div>
                )}

                {response && (
                    <div className={styles["response-container"]}>
                        <h4>Response:</h4>
                        <Card className={styles["response-card"]}>
                            <Markdown>{response}</Markdown>
                        </Card>
                    </div>
                )}

                {!response && !error && !isLoading && (
                    <NonIdealState
                        icon="code"
                        title="AI Coding Assistant"
                        description="Select an action and provide a prompt to get AI-powered coding assistance."
                    />
                )}
            </div>
        </div>
    );
}
