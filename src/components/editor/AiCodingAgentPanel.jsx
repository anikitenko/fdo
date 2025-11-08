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
} from "@blueprintjs/core";
import * as styles from "./AiCodingAgentPanel.module.css";
import Markdown from "markdown-to-jsx";

const AI_ACTIONS = [
    { label: "Generate Code", value: "generate" },
    { label: "Edit Code", value: "edit" },
    { label: "Explain Code", value: "explain" },
    { label: "Fix Code", value: "fix" },
];

export default function AiCodingAgentPanel({ codeEditor, editorModelPath }) {
    const [action, setAction] = useState("generate");
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [response, setResponse] = useState("");
    const [error, setError] = useState(null);
    const [streamingRequestId, setStreamingRequestId] = useState(null);
    const responseRef = useRef("");

    useEffect(() => {
        const handleStreamDelta = (data) => {
            if (data.requestId === streamingRequestId && data.type === "content") {
                responseRef.current += data.content;
                setResponse(responseRef.current);
            }
        };

        const handleStreamDone = (data) => {
            if (data.requestId === streamingRequestId) {
                setIsLoading(false);
                setStreamingRequestId(null);
            }
        };

        const handleStreamError = (data) => {
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
    }, [streamingRequestId]);

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

    const handleSubmit = async () => {
        if (!prompt.trim()) return;

        setIsLoading(true);
        setError(null);
        setResponse("");
        responseRef.current = "";

        try {
            const selectedCode = getSelectedCode();
            const language = getLanguage();
            const context = action === "generate" ? getContext() : "";

            let result;
            switch (action) {
                case "generate":
                    result = await window.electron.aiCodingAgent.generateCode({
                        prompt,
                        language,
                        context,
                    });
                    break;
                case "edit":
                    if (!selectedCode) {
                        setError("Please select code to edit");
                        setIsLoading(false);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.editCode({
                        code: selectedCode,
                        instruction: prompt,
                        language,
                    });
                    break;
                case "explain":
                    if (!selectedCode) {
                        setError("Please select code to explain");
                        setIsLoading(false);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.explainCode({
                        code: selectedCode,
                        language,
                    });
                    break;
                case "fix":
                    if (!selectedCode) {
                        setError("Please select code to fix");
                        setIsLoading(false);
                        return;
                    }
                    result = await window.electron.aiCodingAgent.fixCode({
                        code: selectedCode,
                        error: prompt,
                        language,
                    });
                    break;
                default:
                    break;
            }

            if (result && result.requestId) {
                setStreamingRequestId(result.requestId);
            } else if (result && result.error) {
                setError(result.error);
                setIsLoading(false);
            }
        } catch (err) {
            setError(err.message || "An error occurred");
            setIsLoading(false);
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

    return (
        <div className={styles["ai-coding-agent-panel"]}>
            <div className={styles["panel-header"]}>
                <h3>AI Coding Agent</h3>
                <Tag minimal intent="primary">
                    Beta
                </Tag>
            </div>

            <div className={styles["panel-content"]}>
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
                        action === "generate"
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
                            action === "generate"
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

                <div className={styles["action-buttons"]}>
                    <Button
                        intent="primary"
                        text={isLoading ? "Processing..." : "Submit"}
                        icon={isLoading ? <Spinner size={16} /> : "send-message"}
                        onClick={handleSubmit}
                        disabled={isLoading || !prompt.trim()}
                        fill
                    />
                    {response && (
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
