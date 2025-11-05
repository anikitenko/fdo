import * as styles from "../css/AiChatDialog.module.css";
import {
    Button,
    Classes,
    ControlGroup,
    Dialog,
    FormGroup,
    HTMLSelect,
    Icon,
    Tooltip,
    TextArea,
    Tag,
    Switch,
    Popover,
    Spinner, NonIdealState
} from "@blueprintjs/core";
import {AppToaster} from "../AppToaster";
import React, {useEffect, useMemo, useRef, useState} from "react";
import MarkdownRenderer from "./MarkdownRenderer";

export const AiChatDialog = ({showAiChatDialog, setShowAiChatDialog}) => {
    const [session, setSession] = useState(null);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [thinking, setThinking] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [assistants, setAssistants] = useState([]);
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [streaming, setStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const streamingAssistantIdRef = useRef(null);
    const [stats, setStats] = useState(null);
    const [capabilities, setCapabilities] = useState(null);

    const messages = session?.messages || [];

    const chatAssistants = useMemo(() => (assistants || []).filter(a => a.purpose === 'chat'), [assistants]);
    const providerOptions = useMemo(() => {
        const uniq = Array.from(new Set(chatAssistants.map(a => a.provider)));
        return uniq.map(p => ({label: (p || '').charAt(0).toUpperCase() + (p || '').slice(1), value: p}));
    }, [chatAssistants]);
    const modelOptions = useMemo(() => {
        const filtered = chatAssistants.filter(a => !provider || a.provider === provider);
        const uniq = Array.from(new Set(filtered.map(a => a.model)));
        return uniq.map(m => ({label: m, value: m}));
    }, [chatAssistants, provider]);

    useEffect(() => {
        if (!showAiChatDialog) return;
        (async () => {
            try {
                // sessions
                const sessions = await window.electron.aiChat.getSessions();
                if (sessions && sessions.length > 0) {
                    setSession(sessions[0]);
                } else {
                    const created = await window.electron.aiChat.createSession("New Chat");
                    setSession(created);
                }
                // assistants
                const list = await window.electron.settings.ai.getAssistants();
                setAssistants(list || []);
                // Only auto-select the default Chat assistant; do not fallback to the first
                const defaults = (list || []).filter(a => a.purpose === 'chat');
                const def = defaults.find(a => a.default);
                if (def) {
                    setProvider(def.provider);
                    setModel(def.model);
                } else {
                    setProvider("");
                    setModel("");
                }
            } catch (e) {
                AppToaster.show({message: e.message, intent: "danger"});
            }
        })();
    }, [showAiChatDialog]);

    useEffect(() => {
        if (!showAiChatDialog) return;
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages.length, showAiChatDialog]);

    // Streaming event listeners
    useEffect(() => {
        if (!showAiChatDialog || !session?.id) return;
        const onDelta = (data) => {
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev) return prev;
                const msgs = [...(prev.messages || [])];
                let idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                if (idx === -1) {
                    const id = streamingAssistantIdRef.current || crypto.randomUUID?.() || `a-${Math.random().toString(36).slice(2)}`;
                    streamingAssistantIdRef.current = id;
                    msgs.push({
                        id,
                        role: 'assistant',
                        content: '',
                        createdAt: new Date().toISOString(),
                        skeleton: true
                    });
                    idx = msgs.length - 1;
                }
                const m = {...msgs[idx]};
                if (data.type === 'content') {
                    m.content = (m.content || '') + String(data.content || '');
                    m.skeleton = false;
                } else if (data.type === 'thinking') {
                    m.thinking = (m.thinking || '') + String(data.content || '');
                }
                msgs[idx] = m;
                return {...prev, messages: msgs};
            });
        };
        const onDone = (data) => {
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev) return prev;
                const msgs = [...(prev.messages || [])];
                const idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                if (idx !== -1) msgs[idx] = {...msgs[idx], skeleton: false};
                return {...prev, messages: msgs};
            });
            setSending(false);
            streamingAssistantIdRef.current = null;
        };
        const onError = (data) => {
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev) return prev;
                const msgs = [...(prev.messages || [])];
                const idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                const errText = String(data.error || 'Error while streaming');
                if (idx !== -1) {
                    msgs[idx] = {...msgs[idx], skeleton: false, content: errText};
                } else {
                    const id = crypto.randomUUID?.() || `e-${Math.random().toString(36).slice(2)}`;
                    msgs.push({
                        id,
                        role: 'assistant',
                        content: errText,
                        createdAt: new Date().toISOString(),
                        skeleton: false
                    });
                }
                return {...prev, messages: msgs};
            });
            setSending(false);
            streamingAssistantIdRef.current = null;
        };
        const onStats = (data) => {
            // Only accept if it's for current session & dialog is visible
            if (data?.sessionId !== session.id) return;
            const activeStats = data.models?.[model];
            if (activeStats) {
                setStats(activeStats);
                setSession(prev =>
                    prev?.id === data.sessionId
                        ? {
                            ...prev,
                            stats: {
                                ...(prev.stats || {}),
                                models: {
                                    ...(prev.stats?.models || {}),
                                    [model]: activeStats,
                                },
                            },
                        }
                        : prev
                );
            }
        };
        window.electron.aiChat.on.statsUpdate(onStats);
        window.electron.aiChat.on.streamDelta(onDelta);
        window.electron.aiChat.on.streamDone(onDone);
        window.electron.aiChat.on.streamError(onError);
        return () => {
            window.electron.aiChat.off.statsUpdate(onStats);
            window.electron.aiChat.off.streamDelta(onDelta);
            window.electron.aiChat.off.streamDone(onDone);
            window.electron.aiChat.off.streamError(onError);
        };
    }, [showAiChatDialog, session?.id, model]);

    useEffect(() => {
        if (!session?.id) return;

        const activeStats =
            session.stats?.models?.[model] ??
            session.stats?.summary ??
            null;
        setStats(activeStats);
    }, [session?.id, session?.stats, model]);

    useEffect(() => {
        if (!model) return;
        window.electron.aiChat.getCapabilities(model, provider)
            .then(caps => {
                setCapabilities(caps);
            })
            .catch(err => {
                AppToaster.show({message: `Capability load failed: ${err.message}`, intent: "warning"});
                console.warn("[AI Chat UI] capability load failed:", err)
            });
    }, [model]);

    useEffect(() => {
        if (stats && stats.percent > 90 && thinking) {
            setThinking(false);
        }
    }, [stats]);

    useEffect(() => {
        document.addEventListener("click", (event) => {
            const target = event.target.closest("a");
            if (target && target.href.startsWith("http")) {
                event.preventDefault();
                window.electron.system.openExternal(target.href)
            }
        });
    }, [])

    const hasAssistants = useMemo(() => (chatAssistants || []).length > 0, [chatAssistants]);
    const canSend = useMemo(() => !sending && !!input.trim() && hasAssistants, [sending, input, hasAssistants]);

    const onSend = async () => {
        const content = input.trim();
        if (!content || !session || sending) return;
        setSending(true);
        setInput("");

        // Optimistic UI: append user message and a skeleton assistant bubble
        const now = new Date().toISOString();
        const tempAssistantId = crypto.randomUUID?.() || `temp-${Math.random().toString(36).slice(2)}`;
        const optimistic = {
            ...session,
            messages: [
                ...(session.messages || []),
                {
                    id: crypto.randomUUID?.() || `u-${Math.random().toString(36).slice(2)}`,
                    role: 'user',
                    content,
                    createdAt: now
                },
                {
                    id: tempAssistantId,
                    role: 'assistant',
                    content: ' ',
                    createdAt: now,
                    skeleton: true,
                    thinkingRequested: thinking
                },
            ]
        };
        setSession(optimistic);

        // Set streaming bubble id so deltas update this one
        streamingAssistantIdRef.current = tempAssistantId;
        try {
            const updated = await window.electron.aiChat.sendMessage({
                sessionId: session.id,
                content,
                think: thinking,
                stream: streaming || thinking,
                provider,
                model
            });
            // Replace with authoritative session from main (removes skeleton)
            setSession(updated);
        } catch (e) {
            AppToaster.show({message: e.message, intent: "danger"});
            // Replace skeleton with error text locally if call failed
            setSession(prev => {
                const msgs = (prev?.messages || []).map(m => (
                    m.id === tempAssistantId ? {
                        ...m,
                        skeleton: false,
                        content: `Error: ${e?.message || 'Failed to send message'}`
                    } : m
                ));
                return {...(prev || session), messages: msgs};
            });
        } finally {
            setSending(false);
        }
    };

    const onKeyDown = (e) => {
        // Enter sends; Shift+Enter inserts newline; Cmd/Ctrl+Enter toggles Thinking
        if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
            if (!canSend) return;
            e.preventDefault();
            onSend();
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            setOptionsOpen(true);
        }
    };

    return (
        <Dialog
            autoFocus={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            isOpen={showAiChatDialog}
            isCloseButtonShown={true}
            onClose={() => setShowAiChatDialog(false)}
            title={<><Icon icon={"chat"} intent={"primary"} style={{paddingLeft: "3px"}} size={20}/><span
                className={"bp6-heading"}
                style={{fontSize: "1.2rem"}}>Chat with AI Assistant</span></>}
            style={{
                minWidth: 900,
                paddingBottom: 0,
                height: 620,
                padding: "5px",
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            <div style={{flex: 1, overflow: 'auto', padding: '0 1rem'}}>
                {!hasAssistants ? (
                    <NonIdealState
                        icon="manual"
                        title="No AI Assistants yet"
                        description="Add your first AI Assistant to integrate intelligent collaboration into your workflow."
                    />
                ) : (<>
                        {(messages || []).map(m => {
                            const isAssistant = m.role === 'assistant';
                            const isStreamingLive = isAssistant && (streamingAssistantIdRef.current === m.id) && sending;
                            const showActivityHeader = isAssistant && (m.skeleton || isStreamingLive);
                            const headerLabel = m.thinkingRequested ? 'Thinking…' : 'Responding…';
                            return (
                                <div key={m.id} style={{
                                    display: 'flex',
                                    justifyContent: isAssistant ? 'flex-start' : 'flex-end',
                                    margin: '8px 0'
                                }}>
                                    <div
                                        className={`${styles.bubble} ${isAssistant ? styles.assistantBubble : styles.userBubble}`}>
                                        {showActivityHeader && (
                                            <div className={styles.thinkingHeader}>
                                                <Spinner size={14} intent="none" style={{color: '#000'}}/>
                                                <span>{headerLabel}</span>
                                            </div>
                                        )}
                                        {isAssistant && m.thinking && (
                                            <div className={styles.thinkingBlock}>
                                                {m.thinking}
                                            </div>
                                        )}
                                        <MarkdownRenderer text={m.content} skeleton={m.skeleton} role={m.role} />
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef}/>
                    </>
                )}
            </div>
            <div
                className={Classes.DIALOG_FOOTER}
                style={{
                    borderTop: "1px solid var(--bp6-divider-color)",
                    padding: "0.5rem 1rem",
                    background: "var(--bp6-elevation-1)",
                }}
            >
                <ControlGroup fill={true} vertical={false}>
                    <Button
                        icon="history"
                        variant={"minimal"}
                        title="Session History"
                    />
                    <Button
                        icon="plus"
                        variant={"minimal"}
                        title={"Attach"}
                    />
                    <TextArea
                        placeholder={hasAssistants ? "Type a message..." : "Add a Chat assistant in Settings to start chatting"}
                        fill
                        autoResize={true}
                        className={styles.sendMessageInput}
                        size={"small"}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={sending || !hasAssistants}
                    />
                    <Popover
                        isOpen={optionsOpen}
                        onInteraction={(state) => setOptionsOpen(state)}
                        placement="top"
                        content={
                            <div style={{padding: 12, minWidth: 260}}>
                                <FormGroup label="Thinking mode">
                                    <Switch
                                        checked={thinking}
                                        onChange={(e) => {
                                            const next = e.target.checked;
                                            setThinking(next);
                                            // Keep streaming in sync with Thinking: ON -> ON, OFF -> OFF
                                            setStreaming(next);
                                        }}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                        disabled={!capabilities?.reasoning}
                                    />
                                </FormGroup>
                                <FormGroup label="Streaming">
                                    <Switch
                                        checked={streaming}
                                        onChange={(e) => setStreaming(e.target.checked)}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                        disabled={thinking || !capabilities?.streaming}
                                    />
                                    {thinking &&
                                        <div style={{fontSize: 11, opacity: 0.8, marginTop: 4}}>Auto-enabled while
                                            Thinking is ON</div>}
                                </FormGroup>
                                <FormGroup label="Provider">
                                    <HTMLSelect
                                        options={providerOptions}
                                        value={provider}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setProvider(next);
                                            // Auto-select the first model for this provider
                                            const nextModels = (chatAssistants.filter(a => a.provider === next).map(a => a.model));
                                            if (nextModels && nextModels.length > 0) {
                                                setModel(nextModels[0]);
                                            } else {
                                                setModel("");
                                            }
                                        }}
                                    />
                                </FormGroup>
                                <FormGroup label="Model">
                                    <HTMLSelect
                                        options={modelOptions}
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                    />
                                </FormGroup>
                            </div>
                        }
                    >
                        <Button
                            icon="cog"
                            variant={"minimal"}
                            title={"Chat options (Cmd/Ctrl+Enter)"}
                            onClick={() => setOptionsOpen(v => !v)}
                        />
                    </Popover>
                    <Tooltip content={<span>
                        <div>Enter: Send message</div>
                        <div>Shift+Enter: New line</div>
                        <div>Cmd/Ctrl+Enter: Chat options</div>
                    </span>}>
                        <Button
                            intent="primary"
                            icon={sending ? "cloud-upload" : "send-message"}
                            variant={"minimal"}
                            title={"Send"}
                            onClick={onSend}
                            disabled={!canSend}
                        />
                    </Tooltip>
                </ControlGroup>
                {stats && (
                    <div
                        style={{
                            marginTop: "6px",
                            fontSize: "12px",
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        {/* 🔹 Label tag — model name or "Session Total" */}
                        {stats.lastModel && "Last used model: "}
                        <Tag
                            minimal
                            intent="none"
                            style={{opacity: stats.model ? 1 : 0.7}}
                        >
                            {stats.model || stats.lastModel || "Session Total"}
                        </Tag>

                        {/* 🔹 Usage / percentage tag */}
                        {stats.maxTokens && stats.percentUsed ? (
                            <>
                            <Tag
                                minimal
                                intent={
                                    stats.percentUsed > 80
                                        ? "danger"
                                        : stats.percentUsed > 50
                                            ? "warning"
                                            : "success"
                                }
                            >
                                {`${Math.round(stats.percentUsed)}% of ${stats.maxTokens.toLocaleString()} tokens`}
                            </Tag>
                            <Tag minimal intent="none">
                                {`${(stats.estimatedUsed ?? 0).toLocaleString()} tokens used`}
                            </Tag>
                            </>
                        ) : (
                            <Tag minimal intent="none">
                                {`${(stats.totalTokens ?? 0).toLocaleString()} tokens used`}
                            </Tag>
                        )}

                        {/* 🔹 Details line */}
                        <span>
                          {stats.totalMessages
                              ? `• ${stats.totalMessages} msg`
                              : stats.messageCount
                                  ? `• ${stats.messageCount} msg`
                                  : ""}
                        </span>
                    </div>
                )}
            </div>
        </Dialog>
    )
}