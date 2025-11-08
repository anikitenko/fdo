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
    Spinner, NonIdealState, Slider, MenuDivider, MenuItem, Menu
} from "@blueprintjs/core";
import {AppToaster} from "../AppToaster";
import React, {useEffect, useMemo, useRef, useState} from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import NewSessionDialog from "./components/NewSessionDialog";
import AttachFromUrlDialog from "./components/AttachFromUrlDialog";
import {shortenUrl} from "./utils/shortenUrl";

const costUsageTooltip = (
    inputTokens, outputTokens, local, totalTokens, inputCost, outputCost, totalCost
) => {
    const formatCost = (value) => `$${value.toFixed(5)}`;
    const formatTokens = (num) =>
        num >= 1000 ? `${(num / 1000).toFixed(1)}K` : num.toString();
    if (!inputTokens && !outputTokens && !local && !totalTokens && !inputCost && !outputCost && !totalCost) return null
    return (
        <div>
            <div>Input tokens: {formatTokens(inputCost)}</div>
            <div>Output tokens: {formatTokens(outputCost)}</div>
            <div>Local: {local ? "yes" : "no"}</div>
            <div>Total tokens: {formatTokens(totalTokens)}</div>
            <div>Input cost: {formatCost(inputCost)}</div>
            <div>Output cost: {formatCost(outputCost)}</div>
            <div>Total cost: {formatCost(totalCost)}</div>
        </div>
    )
}

export const AiChatDialog = ({showAiChatDialog, setShowAiChatDialog}) => {
    const [session, setSession] = useState(null);
    const [sessionList, setSessionList] = useState([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [thinking, setThinking] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [attachmentOpen, setAttachmentOpen] = useState(false);
    const [assistants, setAssistants] = useState([]);
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [streaming, setStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const streamingAssistantIdRef = useRef(null);
    const [stats, setStats] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    const [summarizingProgress, setSummarizingProgress] = useState(false);
    const [summarizingModel, setSummarizingModel] = useState("");
    const [temperature, setTemperature] = useState(0.7);
    const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
    const [attachFromUrlDialogOpen, setAttachFromUrlDialogOpen] = useState(false);
    const [attachments, setAttachments] = useState([]);

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

    const sessionCreate = async (name, list) => {
        const created = await window.electron.aiChat.createSession(name);
        setSession(created);
        if (list) {
            setSessionList([...list, {id: created.id, name, updatedAt: created.updatedAt}]);
        } else {
            setSessionList([{id: created.id, name, updatedAt: created.updatedAt}]);
        }
    }

    useEffect(() => {
        if (!showAiChatDialog) return;
        (async () => {
            try {
                // sessions
                const sessions = await window.electron.aiChat.getSessions();
                if (sessions && sessions.length > 0) {
                    const mostRecent = sessions.reduce((latest, current) => {
                        return new Date(current.updatedAt) > new Date(latest.updatedAt) ? current : latest;
                    });
                    setSession(mostRecent);
                    const list = sessions.map(({id, name, updatedAt}) => ({
                        id,
                        name,
                        updatedAt,
                    }));
                    setSessionList(list);
                } else {
                    await sessionCreate("New Chat");
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
        const onSummaryStart = (data) => {
            if (data?.sessionId !== session.id) return;
            setSummarizingProgress(true);
            setSummarizingModel(data.model);
        }
        const onSummaryEnd = (data) => {
            if (data?.sessionId !== session.id) return;
            setSummarizingProgress(false);
        }
        window.electron.aiChat.on.compressionStart(onSummaryStart);
        window.electron.aiChat.on.compressionDone(onSummaryEnd);
        window.electron.aiChat.on.statsUpdate(onStats);
        window.electron.aiChat.on.streamDelta(onDelta);
        window.electron.aiChat.on.streamDone(onDone);
        window.electron.aiChat.on.streamError(onError);
        return () => {
            window.electron.aiChat.off.compressionStart(onSummaryStart);
            window.electron.aiChat.off.compressionDone(onSummaryEnd);
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
            if (target && (target.href.startsWith("http") || target.href.startsWith("file://"))) {
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
                    createdAt: now,
                    attachments,
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
                model,
                temperature,
                attachments,
            });
            // Replace with authoritative session from main (removes skeleton)
            setSession(updated);
            setAttachments([])
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
            // Important: do NOT clear attachments on error
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

    const onSessionChange = async (id) => {
        const sessions = await window.electron.aiChat.getSessions();
        const session = sessions.find(s => s.id === id);
        if (session) {
            setSession(session);
        } else {
            setSession(null);
        }
    }

    const onOpenFromLocal = async () => {
        const data = await window.electron.system.openFileDialog({
            title: 'Select files to attach',
            buttonLabel: 'Attach',
            properties: ['openFile', 'multiSelections'],
        }, true)
        if (!data) return;
        const newAttachments = []
        const fileTypes = await window.electron.aiChat.detectAttachmentType(data)
        for (const file of data) {
            const basename = file.split(/[\\/]/).pop();
            newAttachments.push({
                name: basename,
                path: file,
                type: 'local',
                category: fileTypes.find(t => t.path === file)?.type,
            })
        }
        const newAttachmentsList = [...attachments, ...newAttachments];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const onOpenFromUrl = (url) => {
        const makeShortenUrl = shortenUrl(url);
        if (!makeShortenUrl) return;
        const newAttachmentsList = [...attachments, {
            name: makeShortenUrl,
            path: url,
            type: 'url',
        }];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const onOpenFromSession = async (id) => {
        const sessions = await window.electron.aiChat.getSessions();
        const session = sessions.find(s => s.id === id);
        const newAttachmentsList = [...attachments, {
            name: session.name,
            path: session.id,
            type: 'session',
        }];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const attachmentIntentType = (type) => {
        switch (type) {
            case 'local':
                return 'primary';
            case 'url':
                return 'success';
            case 'session':
                return 'warning';
            default:
                return 'none';
        }
    }

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
                                        {m.role === 'user' ? (
                                            <MarkdownRenderer text={m.content} attachments={m.contentAttachments} skeleton={m.skeleton} role={m.role}/>
                                        ) : (
                                            <Tooltip content={costUsageTooltip(
                                                m.inputTokens, m.outputTokens, m.local, m.totalTokens, m.inputCost, m.outputCost, m.totalCost
                                            )}>
                                                <MarkdownRenderer text={m.content} skeleton={m.skeleton} role={m.role}/>
                                            </Tooltip>
                                        )}
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
                    <Popover
                        isOpen={historyOpen}
                        onInteraction={(state) => setHistoryOpen(state)}
                        placement="top"
                        content={
                            <div style={{
                                padding: 12,
                                maxWidth: 320,
                                maxHeight: "300px",
                                flexDirection: "column",
                                display: "flex"
                            }}>
                                <div
                                    style={{
                                        position: "sticky",
                                        top: 0,
                                        zIndex: 2,
                                        background: "var(--pt-app-background-color, #fff)",
                                    }}
                                >
                                    <Menu>
                                        <MenuItem icon="add" text="New session" intent="primary"
                                                  onClick={() => setNewSessionDialogOpen(true)}/>
                                        <MenuDivider/>
                                    </Menu>
                                </div>
                                <div
                                    style={{
                                        overflowY: "auto",
                                        flex: "1 1 auto",
                                    }}
                                >
                                    <Menu>
                                        {[...sessionList]
                                            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(s => (
                                                <MenuItem key={s.id} intent={s.id === session.id ? "success" : "none"}
                                                          icon={s.id === session.id ? "tick" : null}
                                                          text={s.name}
                                                          onClick={() => onSessionChange(s.id)}
                                                />
                                            ))
                                        }
                                    </Menu>
                                </div>
                            </div>
                        }
                    >
                        <Button
                            icon="history"
                            variant={"minimal"}
                            title="Session History"
                            onClick={() => setHistoryOpen(v => !v)}
                        />
                    </Popover>
                    <Popover
                        isOpen={attachmentOpen}
                        onInteraction={(state) => setAttachmentOpen(state)}
                        placement="top"
                        content={
                            <div style={{
                                padding: 12,
                            }}>
                                <Menu>
                                    <MenuItem icon="clipboard-file" text="From local PDF/image" intent="primary" onClick={onOpenFromLocal}/>
                                    <MenuItem icon="globe-network-add" text="From image URL" intent="primary" onClick={() => setAttachFromUrlDialogOpen(true)}/>
                                    <MenuItem text="From session" icon="chat" intent="primary">
                                        {[...sessionList]
                                            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).filter(s => s.id !== session.id).map(s => (
                                                <MenuItem key={`attachment-${s.id}`}
                                                          text={s.name} onClick={() => onOpenFromSession(s.id)}
                                                />
                                            ))
                                        }
                                    </MenuItem>
                                </Menu>
                            </div>
                        }
                    >
                        <Button
                            icon="plus"
                            variant={"minimal"}
                            title={"Attach"}
                            onClick={() => setAttachmentOpen(v => !v)}
                        />
                    </Popover>
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
                        autoFocus={true}
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
                                <FormGroup label="Temperature">
                                    <Slider
                                        handleHtmlProps={{"aria-label": "temperature"}}
                                        labelStepSize={2}
                                        max={2}
                                        min={0}
                                        onChange={setTemperature}
                                        stepSize={0.1}
                                        value={temperature}
                                        vertical={false}
                                    />
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
                {attachments.length > 0 && (
                    <div style={{ marginTop: "5px" }}>
                        <div style={{ marginBottom: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {attachments.map((a) => (
                                <Tag
                                    key={a.path}
                                    round
                                    onRemove={() => {
                                        if (sending) return;
                                        setAttachments(as => as.filter(aa => aa.path !== a.path))
                                    }}
                                    intent={attachmentIntentType(a.type)}
                                    style={{ cursor: "default" }}
                                >
                                    {a.name}
                                </Tag>
                            ))}
                        </div>
                    </div>
                )}
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
                {summarizingProgress && (
                    <div
                        style={{display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 8}}>
                        <Spinner size={14} intent="none" style={{color: '#000'}}/>
                        <span>Summarizing chat history for model {summarizingModel}...</span>
                    </div>
                )}
            </div>
            <NewSessionDialog isOpen={newSessionDialogOpen} setIsOpen={setNewSessionDialogOpen}
                              onSubmit={(name) => sessionCreate(name, sessionList)}/>
            <AttachFromUrlDialog isOpen={attachFromUrlDialogOpen} setIsOpen={setAttachFromUrlDialogOpen} onSubmit={(url) => {onOpenFromUrl(url)}}/>
        </Dialog>
    )
}