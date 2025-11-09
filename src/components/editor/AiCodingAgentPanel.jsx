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
    const timeoutRef = useRef(null);
    const streamingRequestIdRef = useRef(null);
    const autoApplyRef = useRef(autoApply);

    // Load SDK types on mount
    useEffect(() => {
        async function loadSdkTypes() {
            try {
                const result = await window.electron.system.getFdoSdkTypes();
                if (result && result.success && result.files) {
                    setSdkTypes(result.files);
                    console.log('[AI Coding Agent] SDK types loaded', { filesCount: result.files.length });
                } else {
                    console.error('[AI Coding Agent] Failed to load SDK types', result ? result.error : 'Unknown error');
                }
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

    // Keep autoApplyRef in sync with autoApply state
    useEffect(() => {
        autoApplyRef.current = autoApply;
    }, [autoApply]);

    // Store handlers in refs to ensure proper cleanup and prevent duplicates
    const handlersRef = useRef({
        delta: null,
        done: null,
        error: null
    });

    useEffect(() => {
        // Create handler functions
        const handleStreamDelta = (data) => {
            console.log('[AI Coding Agent] Stream delta received', { requestId: data.requestId, contentLength: data.content ? data.content.length : 0 });
            // Robust validation: only process if requestId matches AND content is valid
            if (data.requestId === streamingRequestIdRef.current && 
                data.content && 
                typeof data.content === 'string' &&
                data.content.length > 0 &&
                /\S/.test(data.content)) {  // Must contain at least one non-whitespace character
                
                responseRef.current += data.content;
                setResponse(responseRef.current);
                console.log('[AI Coding Agent] Response updated', { totalLength: responseRef.current.length });
            }
        };

        const handleStreamDone = (data) => {
            console.log('[AI Coding Agent] Stream done', { requestId: data.requestId, streamingRequestId: streamingRequestIdRef.current });
            if (data.requestId === streamingRequestIdRef.current) {
                // ALWAYS clear timeout FIRST (critical to prevent timeout errors)
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                    console.log('[AI Coding Agent] Timeout cleared');
                }
                
                // THEN check if already completed (backend sends multiple done events)
                if (!isLoading) {
                    console.log('[AI Coding Agent] Already completed, skipping duplicate done event');
                    return;
                }
                
                console.log('[AI Coding Agent] Completing stream');
                setIsLoading(false);
                
                // DON'T clear streamingRequestIdRef here - let the IPC completion handler do it
                // This allows subsequent done events to still match
                
                // Auto-apply if enabled - use ref to get latest value
                if (autoApplyRef.current && responseRef.current) {
                    autoInsertCodeIntoEditor();
                }
            } else {
                console.warn('[AI Coding Agent] Stream done but requestId mismatch', { received: data.requestId, expected: streamingRequestIdRef.current });
            }
        };

        const handleStreamError = (data) => {
            console.error('[AI Coding Agent] Stream error', data);
            if (data.requestId === streamingRequestIdRef.current) {
                setError(data.error);
                setIsLoading(false);
                setStreamingRequestId(null);
                streamingRequestIdRef.current = null;
                
                // Clear timeout
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                }
            }
        };

        // Store handlers in ref for cleanup
        handlersRef.current = {
            delta: handleStreamDelta,
            done: handleStreamDone,
            error: handleStreamError
        };

        // Register event handlers
        window.electron.aiCodingAgent.on.streamDelta(handleStreamDelta);
        window.electron.aiCodingAgent.on.streamDone(handleStreamDone);
        window.electron.aiCodingAgent.on.streamError(handleStreamError);

        console.log('[AI Coding Agent] Event handlers registered');

        return () => {
            // Use stored refs for cleanup to ensure we remove the exact same handlers
            if (handlersRef.current.delta) {
                window.electron.aiCodingAgent.off.streamDelta(handlersRef.current.delta);
            }
            if (handlersRef.current.done) {
                window.electron.aiCodingAgent.off.streamDone(handlersRef.current.done);
            }
            if (handlersRef.current.error) {
                window.electron.aiCodingAgent.off.streamError(handlersRef.current.error);
            }
            console.log('[AI Coding Agent] Event handlers cleaned up');
        };
    }, []); // Empty dependency array - only register once

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

    const buildProjectContext = (currentFileContext) => {
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
            context += `Current file content:\n${currentFileContext}\n\n`;
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

        // Clear any existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Set a safety timeout to prevent hanging forever
        timeoutRef.current = setTimeout(() => {
            console.error('[AI Coding Agent] Request timeout after 60s');
            setError("Request timed out. The AI service may be unavailable. Please try again.");
            setIsLoading(false);
            setStreamingRequestId(null);
            timeoutRef.current = null;
        }, 60000); // 60 second timeout

        try {
            const selectedCode = getSelectedCode();
            const language = getLanguage();
            const currentFileContext = getContext();
            
            // Build comprehensive project context for smart mode and generate
            const enhancedContext = (action === "smart" || action === "generate")
                ? buildProjectContext(currentFileContext)
                : "";

            console.log('[AI Coding Agent] Preparing request', { 
                action, 
                hasCode: !!selectedCode, 
                language,
                contextLength: enhancedContext.length
            });

            // Generate requestId upfront so we can track streaming events
            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            streamingRequestIdRef.current = requestId;
            setStreamingRequestId(requestId);
            console.log('[AI Coding Agent] Request ID set', requestId);

            let result;
            switch (action) {
                case "smart":
                    result = await window.electron.aiCodingAgent.smartMode({
                        requestId,
                        prompt,
                        code: selectedCode,
                        language,
                        context: enhancedContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "generate":
                    result = await window.electron.aiCodingAgent.generateCode({
                        requestId,
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
                        if (timeoutRef.current) {
                            clearTimeout(timeoutRef.current);
                            timeoutRef.current = null;
                        }
                        return;
                    }
                    result = await window.electron.aiCodingAgent.editCode({
                        requestId,
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
                        if (timeoutRef.current) {
                            clearTimeout(timeoutRef.current);
                            timeoutRef.current = null;
                        }
                        return;
                    }
                    result = await window.electron.aiCodingAgent.explainCode({
                        requestId,
                        code: selectedCode,
                        language,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "fix":
                    if (!selectedCode) {
                        setError("Please select code to fix");
                        setIsLoading(false);
                        if (timeoutRef.current) {
                            clearTimeout(timeoutRef.current);
                            timeoutRef.current = null;
                        }
                        return;
                    }
                    result = await window.electron.aiCodingAgent.fixCode({
                        requestId,
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

            if (result && result.success && result.requestId) {
                console.log('[AI Coding Agent] Request successful, streaming complete', { requestId: result.requestId });
                // Request ID already set before IPC call, streaming events should have flowed
                // Verify requestId matches
                if (result.requestId !== requestId) {
                    console.warn('[AI Coding Agent] RequestId mismatch in result', { expected: requestId, received: result.requestId });
                }
                
                // Clear streamingRequestId now that IPC is complete
                // This prevents any late/duplicate done events from matching
                streamingRequestIdRef.current = null;
                setStreamingRequestId(null);
            } else if (result && result.error) {
                console.error('[AI Coding Agent] Error in result', result.error);
                setError(result.error);
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                setStreamingRequestId(null);
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                }
            } else {
                console.error('[AI Coding Agent] Invalid result - missing requestId or success flag', result);
                setError("Invalid response from AI service. Please try again.");
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                setStreamingRequestId(null);
                if (timeoutRef.current) {
                    clearTimeout(timeoutRef.current);
                    timeoutRef.current = null;
                }
            }
        } catch (err) {
            console.error('[AI Coding Agent] Exception in handleSubmit', err);
            setError(err.message || "An error occurred");
            setIsLoading(false);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        }
    };

    const insertCodeIntoEditor = () => {
        if (!codeEditor || !response) {
            console.log('[AI Coding Agent] Cannot insert - no editor or response');
            return;
        }

        const selection = codeEditor.getSelection();
        const model = codeEditor.getModel();
        if (!model) {
            console.log('[AI Coding Agent] Cannot insert - no model');
            return;
        }

        // Priority 1: Look for SOLUTION-marked code block (<!-- SOLUTION -->)
        const solutionRegex = /```(?:\w+)?\s*\n\s*<!--\s*SOLUTION\s*-->\s*\n([\s\S]*?)```/g;
        const solutionMatches = [...response.matchAll(solutionRegex)];
        
        let codeToInsert;
        if (solutionMatches.length > 0) {
            // Use the SOLUTION-marked code block (the actual code to insert)
            codeToInsert = solutionMatches[0][1].trim();
            console.log('[AI Coding Agent] Inserting SOLUTION-marked code block', { 
                solutionBlocksFound: solutionMatches.length,
                codeLength: codeToInsert.length 
            });
        } else {
            // Priority 2: Look for any code blocks
            const anyCodeRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
            const anyMatches = [...response.matchAll(anyCodeRegex)];
            
            if (anyMatches.length > 0) {
                // Use the LAST code block (most likely the actual code, not an example)
                codeToInsert = anyMatches[anyMatches.length - 1][1].trim();
                console.log('[AI Coding Agent] Inserting last code block', { 
                    codeBlocksFound: anyMatches.length,
                    codeLength: codeToInsert.length 
                });
            } else {
                // Priority 3: No code blocks - use full response
                codeToInsert = response.trim();
                console.log('[AI Coding Agent] No code blocks found, inserting full response');
            }
        }

        const edit = {
            range: selection,
            text: codeToInsert,
            forceMoveMarkers: true,
        };

        model.pushEditOperations([], [edit], () => null);
        codeEditor.focus();
        
        console.log('[AI Coding Agent] Code inserted successfully');
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
