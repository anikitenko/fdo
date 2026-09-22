import React, { useState, useEffect } from "react";
import {
    Button,
    Card,
    Dialog,
    FormGroup,
    InputGroup,
    HTMLSelect,
    H2,
    NonIdealState,
    Spinner, Tag
} from "@blueprintjs/core";
import * as styles from "../../css/SettingsDialog.module.css";
import {AppToaster} from "../../AppToaster";

const PROVIDERS = [
    {label: "Gemini API (Google)", value: "gemini"},
    {label: "Cloudflare Workers AI", value: "cloudflare"},
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Ollama (local)", value: "ollama" },
    { label: "Codex CLI (ChatGPT)", value: "codex-cli" },
    { label: "Gemini CLI (Google)", value: "gemini-cli" },
]

const PURPOSES = [
    { label: "Chat Assistant", value: "chat" },
    { label: "Coding Assistant", value: "coding" },
];

const THINKING_DEFAULTS = [
    { label: "Auto", value: "auto" },
    { label: "On", value: "on" },
    { label: "Off", value: "off" },
];

const EMPTY_CODEX_AUTH_DIALOG = {
    open: false,
    assistant: null,
    loading: false,
    action: "",
    autoCloseOnAuthorized: false,
};

export default function AIAssistantsPanel() {
    const [assistants, setAssistants] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [providerModels, setProviderModels] = useState([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [modelsError, setModelsError] = useState("");
    const [codexAuthDialog, setCodexAuthDialog] = useState(EMPTY_CODEX_AUTH_DIALOG);

    const [form, setForm] = useState({
        name: "",
        provider: "openai",
        model: "",
        purpose: "chat",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434",
        contextLength: 32768,
        accountId: "",
        executablePath: "",
        defaultThinkingMode: "auto",
        firstResponseTimeoutMs: "",
    });

    const filteredModels = providerModels;

    useEffect(() => {
        if (!isDialogOpen) {
            setProviderModels([]);
            setIsLoadingModels(false);
            setModelsError("");
            return;
        }

        if (form.provider === "codex-cli" || form.provider === "gemini-cli") {
            let cancelled = false;

            (async () => {
                try {
                    setIsLoadingModels(true);
                    setModelsError("");
                    const models = await window.electron.settings.ai.getAvailableModels(form.provider, "");
                    if (cancelled) return;
                    setProviderModels(models);
                    setForm((prev) => {
                        const hasCurrentModel = models.some((model) => model.value === prev.model);
                        return {
                            ...prev,
                            model: hasCurrentModel ? prev.model : (models[0]?.value || (form.provider === "codex-cli" ? "gpt-5.3-codex" : "gemini-2.5-pro")),
                            purpose: "coding",
                        };
                    });
                } catch (err) {
                    if (cancelled) return;
                    setProviderModels([]);
                    setModelsError(err.message || (form.provider === "codex-cli" ? "Failed to load Codex models." : "Failed to load Gemini models."));
                    setForm((prev) => ({ ...prev, purpose: "coding" }));
                } finally {
                    if (!cancelled) {
                        setIsLoadingModels(false);
                    }
                }
            })();

            return () => {
                cancelled = true;
            };
        }

        const apiKey = form.apiKey.trim();
        if ((!apiKey && form.provider !== "ollama") || (form.provider === "cloudflare" && !/^[a-f0-9]{32}$/i.test(form.accountId.trim()))) {
            setProviderModels([]);
            setIsLoadingModels(false);
            setModelsError("");
            if (form.model) {
                setForm((prev) => ({ ...prev, model: "" }));
            }
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                setIsLoadingModels(true);
                setModelsError("");
                const models = await window.electron.settings.ai.getAvailableModels(form.provider, apiKey, form.baseUrl,
                    ...(form.provider === "cloudflare" ? [form.accountId.trim()] : []));
                if (cancelled) return;

                setProviderModels(models);
                setForm((prev) => {
                    const hasCurrentModel = models.some((model) => model.value === prev.model);
                    return {
                        ...prev,
                        model: hasCurrentModel ? prev.model : (models[0]?.value || ""),
                    };
                });
            } catch (err) {
                if (cancelled) return;
                setProviderModels([]);
                setModelsError(err.message || `Failed to load ${form.provider} models.`);
                setForm((prev) => ({ ...prev, model: "" }));
            } finally {
                if (!cancelled) {
                    setIsLoadingModels(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [form.apiKey, form.provider, form.baseUrl, form.accountId, isDialogOpen]);

    useEffect(() => {
        (async () => {
            try {
                const list = await window.electron.settings.ai.getAssistants();
                setAssistants(list);
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        })();

        // Listen for real-time updates from the main process
        const handleUpdate = (_, updatedList) => {
            setAssistants(updatedList);
        };

        if (window.electron.settings.ai.on?.updated) {
            window.electron.settings.ai.on.updated(handleUpdate);
            return () => {
                window.electron.settings.ai.off?.updated?.(handleUpdate);
            };
        }
    }, []);

    useEffect(() => {
        if (!codexAuthDialog.open || !codexAuthDialog.assistant?.id) return;
        if (codexAuthDialog.assistant?.codexAuth?.status !== "pending") return;

        const interval = setInterval(async () => {
            try {
                await window.electron.settings.ai.getCodexAuthStatus(codexAuthDialog.assistant.id);
            } catch (_) {
                // Keep polling; transient status-check failures should not freeze dialog state.
            }
            const list = await refreshAssistants();
            const updatedAssistant = list.find((item) => item.id === codexAuthDialog.assistant.id);
            if (updatedAssistant) {
                setCodexAuthDialog((prev) => ({
                    ...prev,
                    assistant: updatedAssistant,
                    loading: updatedAssistant.codexAuth?.status === "pending",
                    action: updatedAssistant.codexAuth?.status === "pending" ? prev.action : "",
                }));
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [codexAuthDialog.open, codexAuthDialog.assistant?.id, codexAuthDialog.assistant?.codexAuth?.status]);

    const handleAdd = async () => {
        try {
            if (!form.name.trim()) throw new Error("Assistant name is required.");
            if (!["codex-cli", "gemini-cli", "ollama"].includes(form.provider) && !form.apiKey.trim()) throw new Error("API key is required.");
            setIsLoading(true);
            const {baseUrl, contextLength, accountId, firstResponseTimeoutMs, executablePath, ...assistantForm} = form;
            const nextForm = {
                ...assistantForm,
                ...(["codex-cli", "gemini-cli"].includes(form.provider) ? {executablePath} : {}),
                ...(form.provider === "ollama" ? {baseUrl, contextLength} : {}),
                ...(form.provider === "cloudflare" ? {accountId: accountId.trim()} : {}),
                ...(form.purpose === "coding" && firstResponseTimeoutMs !== "" ? {firstResponseTimeoutMs} : {}),
                default: true,
                apiKey: ["codex-cli", "gemini-cli", "ollama"].includes(form.provider) ? "" : form.apiKey,
                model: form.provider === "codex-cli"
                    ? (form.model || "gpt-5")
                    : form.provider === "gemini-cli"
                        ? (form.model || "gemini-2.5-pro")
                        : form.model,
                purpose: ["codex-cli", "gemini-cli", "ollama", "cloudflare"].includes(form.provider) ? "coding" : form.purpose,
                defaultThinkingMode: form.defaultThinkingMode || "auto",
            };
            await window.electron.settings.ai.addAssistant(nextForm);
            const updated = await refreshAssistants();
            const addedAssistant = updated.find((item) =>
                item.name === form.name &&
                item.provider === form.provider &&
                item.purpose === (["codex-cli", "gemini-cli", "ollama"].includes(form.provider) ? "coding" : form.purpose)
            );

            if (["codex-cli", "gemini-cli"].includes(form.provider) && addedAssistant) {
                if (addedAssistant.codexAuth?.status !== "authorized") {
                    setCodexAuthDialog({
                        open: true,
                        assistant: addedAssistant,
                        loading: false,
                        action: addedAssistant.codexAuth?.status === "pending" ? "login" : "",
                        autoCloseOnAuthorized: true,
                    });
                }
                AppToaster.show({
                    message: addedAssistant.codexAuth?.status === "authorized"
                        ? `AI Assistant “${form.name}” added successfully.`
                        : `AI Assistant “${form.name}” added and ${form.provider === "gemini-cli" ? "Gemini sign-in" : "Codex authentication"} started.`,
                    intent: "success",
                });
            } else {
                AppToaster.show({
                    message: `AI Assistant “${form.name}” added successfully.`,
                    intent: "success",
                });
            }

            setIsDialogOpen(false);
            setForm({
                name: "",
                provider: "openai",
                model: "",
                purpose: "chat",
                apiKey: "",
                baseUrl: "http://127.0.0.1:11434",
                contextLength: 32768,
                accountId: "",
                executablePath: "",
                defaultThinkingMode: "auto",
                firstResponseTimeoutMs: "",
            });
        } catch (err) {
            AppToaster.show({ message: err.message, intent: "danger" });
        } finally {
            setIsLoading(false);
        }
    };

    const setDefault = async (name, purpose) => {
        try {
            await window.electron.settings.ai.setDefaultAssistant({name, purpose});
            const list = await window.electron.settings.ai.getAssistants();
            setAssistants(list);
        } catch (err) {
            AppToaster.show({ message: err.message, intent: "danger" });
        }
    };

    const handleDelete = async (data) => {
        try {
            await window.electron.settings.ai.removeAssistant(data);
            const list = await window.electron.settings.ai.getAssistants();
            setAssistants(list);
            AppToaster.show({ message: `AI Assistant “${data.name}” removed.`, intent: "warning" });
        } catch (err) {
            AppToaster.show({ message: err.message, intent: "danger" });
        }
    };

    const refreshAssistants = async () => {
        const list = await window.electron.settings.ai.getAssistants();
        setAssistants(list);
        return list;
    };

    const closeCodexAuthDialog = () => {
        setCodexAuthDialog(EMPTY_CODEX_AUTH_DIALOG);
    };

    const openCodexAuthDialog = (assistant) => {
        setCodexAuthDialog({
            open: true,
            assistant,
            loading: false,
            action: "",
            autoCloseOnAuthorized: false,
        });
    };

    const runCodexAuthAction = async (action) => {
        if (!codexAuthDialog.assistant?.id) return;
        try {
            setCodexAuthDialog((prev) => ({ ...prev, loading: true, action }));
            let ipcResult = null;
            if (action === "check") {
                ipcResult = await window.electron.settings.ai.getCodexAuthStatus(codexAuthDialog.assistant.id);
            } else if (action === "login") {
                const res = await window.electron.settings.ai.startCodexLogin(codexAuthDialog.assistant.id);
                ipcResult = res?.auth;
            } else if (action === "logout") {
                ipcResult = await window.electron.settings.ai.codexLogout(codexAuthDialog.assistant.id);
            } else if (action === "cancel") {
                ipcResult = await window.electron.settings.ai.cancelCodexAuth(codexAuthDialog.assistant.id);
            }

            const list = await refreshAssistants();
            let updatedAssistant = list.find((item) => item.id === codexAuthDialog.assistant.id) || codexAuthDialog.assistant;

            // If we have a direct result from the IPC call, prefer it (it's the most recent state)
            if (ipcResult && updatedAssistant) {
                updatedAssistant = { ...updatedAssistant, codexAuth: ipcResult };
            }

            setCodexAuthDialog((prev) => ({
                ...prev,
                loading: updatedAssistant.codexAuth?.status === "pending",
                assistant: updatedAssistant,
                action: updatedAssistant.codexAuth?.status === "pending" ? action : "",
                autoCloseOnAuthorized: action === "login" || (prev.autoCloseOnAuthorized && updatedAssistant.codexAuth?.status !== "authorized"),
            }));
        } catch (err) {
            setCodexAuthDialog((prev) => ({ ...prev, loading: false, action: "" }));
            AppToaster.show({ message: err.message, intent: "danger" });
        }
    };

    useEffect(() => {
        if (!codexAuthDialog.open || codexAuthDialog.loading) return;
        if (!codexAuthDialog.autoCloseOnAuthorized) return;
        if (codexAuthDialog.assistant?.codexAuth?.status !== "authorized") return;
        const providerLabel = codexAuthDialog.assistant?.provider === "gemini-cli" ? "Gemini" : "Codex";
        const timeout = setTimeout(() => {
            closeCodexAuthDialog();
            AppToaster.show({ message: `${providerLabel} is authenticated and ready for AI Coding Agent.`, intent: "success" });
        }, 1500);
        return () => clearTimeout(timeout);
    }, [codexAuthDialog.open, codexAuthDialog.loading, codexAuthDialog.autoCloseOnAuthorized, codexAuthDialog.assistant?.codexAuth?.status]);

    const formatCodexAuthLabel = (status) => {
        switch (status) {
            case "authorized":
                return "Authenticated";
            case "pending":
                return "Authentication in progress";
            case "unauthorized":
                return "Sign-in required";
            case "timeout":
                return "Authentication timed out";
            case "interrupted":
                return "Authentication interrupted";
            case "cancelled":
                return "Authentication cancelled";
            case "error":
                return "Authentication error";
            default:
                return "Auth state unknown";
        }
    };

    const formatCheckedAt = (checkedAt) => {
        if (!checkedAt) return "Not checked yet";
        const time = new Date(checkedAt).getTime();
        if (!Number.isFinite(time)) return "Not checked yet";
        const diffMs = Date.now() - time;
        if (diffMs < 60_000) return "Last checked just now";
        const diffMin = Math.round(diffMs / 60_000);
        if (diffMin < 60) return `Last checked ${diffMin} min ago`;
        const diffHr = Math.round(diffMin / 60);
        if (diffHr < 24) return `Last checked ${diffHr} hr ago`;
        return `Last checked ${new Date(checkedAt).toLocaleString()}`;
    };

    const formatCodexAuthCardMessage = (assistant) => {
        const status = assistant?.codexAuth?.status || "unknown";
        const message = String(assistant?.codexAuth?.message || "").trim();
        const providerLabel = assistant?.provider === "gemini-cli" ? "Gemini" : "Codex";
        if (message) return message;
        if (status === "authorized") return `${providerLabel} authentication is active.`;
        if (status === "pending") return `${providerLabel} login is in progress.`;
        if (status === "unauthorized") return "Sign in is required.";
        return "Auth state has not been checked yet.";
    };

    const authProviderLabel = codexAuthDialog.assistant?.provider === "gemini-cli" ? "Gemini" : "Codex";
    const authRuntime = codexAuthDialog.assistant?.provider === "gemini-cli"
        ? codexAuthDialog.assistant?.geminiRuntime
        : codexAuthDialog.assistant?.codexRuntime;

    const codexAuthStatus = codexAuthDialog.assistant?.codexAuth?.status || "unknown";
    const codexAuthIntent =
        codexAuthStatus === "authorized" ? "success" :
            codexAuthStatus === "pending" ? "warning" :
                codexAuthStatus === "unauthorized" ? "danger" : "none";
    const codexActionLabel =
        codexAuthDialog.action === "login" ? `Signing in to ${authProviderLabel}...` :
            codexAuthDialog.action === "logout" ? `Signing out of ${authProviderLabel}...` :
                codexAuthDialog.action === "check" ? `Checking ${authProviderLabel} auth...` : "";
    const codexCanSignIn = !codexAuthDialog.loading && !["authorized", "pending"].includes(codexAuthStatus);
    const codexCanPrimaryAction = !codexAuthDialog.loading && codexAuthStatus !== "pending";
    const codexCanSignOut = !codexAuthDialog.loading && ["authorized", "error"].includes(codexAuthStatus);
    const codexCanCheck = !codexAuthDialog.loading;
    const codexCanCancel = !codexAuthDialog.loading && codexAuthStatus === "pending";

    return (
        <div className={styles["card-panel"]}>
            <div className={styles["card-setting-header"]}>
                <H2 style={{ margin: 0 }}>AI Assistants</H2>
                <div style={{ display: "flex", gap: "8px", marginLeft: "auto", borderRadius: "6px" }}>
                    <Button
                        icon="add"
                        text="Add Assistant"
                        intent="primary"
                        onClick={() => setIsDialogOpen(true)}
                    />
                </div>
            </div>

            {isLoading ? (
                <Spinner />
            ) : assistants.length === 0 ? (
                <NonIdealState
                    icon="manual"
                    title="No AI Assistants yet"
                    description="Add your first AI Assistant to integrate intelligent collaboration into your workflow."
                />
            ) : (
                <div>
                    {assistants.map((a) => (
                        <Card key={a.name} style={{padding: "12px 16px"}} interactive={true} onClick={() => setDefault(a.name, a.purpose)}>
                            <div>
                                <H2 style={{ margin: 0 }}>{a.name} {a.default === true && <Tag intent={"success"}>default</Tag>}</H2>
                                <Button
                                    icon="trash"
                                    variant={"minimal"}
                                    intent="danger"
                                    style={{ float: "right" }}
                                    onClick={(e) => { e.stopPropagation(); handleDelete({name: a.name, purpose: a.purpose, id: a.id}); }}
                                />
                            </div>
                            <p>
                                <b>Provider:</b> {PROVIDERS.find((m) => m.value === a.provider)?.label || a.provider}
                            </p>
                            <p>
                                <b>Model:</b> {a.model}
                            </p>
                            <p>
                                <b>Default Thinking:</b>{" "}
                                {THINKING_DEFAULTS.find((item) => item.value === (a.defaultThinkingMode || "auto"))?.label || "Auto"}
                            </p>
                            <p>
                                <b>Purpose:</b>{" "}
                                {PURPOSES.find((p) => p.value === a.purpose)?.label || a.purpose}
                            </p>
                    {(a.provider === "codex-cli" || a.provider === "gemini-cli") && a.executablePath ? (
                                <>
                                    <div className={styles["assistant-meta-row"]}>
                                        <div className={styles["assistant-meta-label"]}>Executable:</div>
                                        <div className={styles["assistant-meta-value"]}>
                                            <span className={styles["dialog-code-value"]}>{a.executablePath}</span>
                                        </div>
                                        {(a.codexRuntime || a.geminiRuntime) ? (
                                            <>
                                                <div className={styles["assistant-meta-label"]}>Runtime:</div>
                                                <div className={styles["assistant-meta-value"]}>
                                                    <span className={styles["dialog-code-value"]}>
                                                        {(a.codexRuntime || a.geminiRuntime).source}
                                                        {(a.codexRuntime || a.geminiRuntime).version ? ` (${(a.codexRuntime || a.geminiRuntime).version})` : ""}
                                                        {(a.codexRuntime || a.geminiRuntime).bundled ? " [bundled]" : ""}
                                                    </span>
                                                </div>
                                            </>
                                        ) : null}
                                        {["codex-cli", "gemini-cli"].includes(a.provider) ? (
                                            <>
                                                <div className={styles["assistant-meta-label"]}>Auth:</div>
                                                <div className={styles["assistant-meta-value"]}>
                                                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                                        <Tag intent={
                                                            (a.codexAuth?.status || "unknown") === "authorized" ? "success" :
                                                                (a.codexAuth?.status || "unknown") === "pending" ? "warning" :
                                                                    (a.codexAuth?.status || "unknown") === "unauthorized" ? "danger" : "none"
                                                        }>
                                                            {formatCodexAuthLabel(a.codexAuth?.status || "unknown")}
                                                        </Tag>
                                                        {a.codexAuth?.checkedAt ? (
                                                            <span style={{ color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: 12 }}>
                                                                {formatCheckedAt(a.codexAuth.checkedAt)}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <span className={styles["dialog-code-value"]}>{formatCodexAuthCardMessage(a)}</span>
                                                </div>
                                            </>
                                        ) : null}
                                    </div>
                                    {["codex-cli", "gemini-cli"].includes(a.provider) ? (
                                        <div className={styles["assistant-card-actions"]}>
                                            <Button
                                                small
                                                text="Manage Auth"
                                                icon="key"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openCodexAuthDialog(a);
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            ) : null}
                        </Card>
                    ))}
                </div>
            )}

            {/* Dialog */}
            <Dialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                title="Add AI Assistant"
                canOutsideClickClose={!isLoading}
            >
                <div className="bp6-dialog-body">

                    <FormGroup label="Name" labelFor="ai-name">
                        <InputGroup
                            id="ai-name"
                            placeholder="e.g. Project Advisor"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                    </FormGroup>

                    <FormGroup label="Provider" labelFor="ai-provider">
                        <HTMLSelect
                            id="ai-provider"
                            options={PROVIDERS}
                            value={form.provider}
                            onChange={(e) => {
                                const provider = e.target.value;
                                setForm({
                                    ...form,
                                    provider,
                                    purpose: ["codex-cli", "gemini-cli", "ollama", "cloudflare"].includes(provider) ? "coding" : form.purpose,
                                    model: "",
                                    firstResponseTimeoutMs: "",
                                });
                            }}
                        />
                    </FormGroup>

                    {form.provider === "cloudflare" ? (
                        <FormGroup label="Cloudflare account ID" labelFor="ai-cloudflare-account"
                            helperText="Use an account-scoped Workers AI API token below. Screenshot requests need a vision model.">
                            <InputGroup id="ai-cloudflare-account" value={form.accountId} placeholder="32-character account ID"
                                onChange={e => setForm({...form, accountId: e.target.value})} />
                        </FormGroup>
                    ) : null}

                    <FormGroup label={form.provider === "codex-cli" ? "Codex Model" : form.provider === "gemini-cli" ? "Gemini Model" : "Model"} labelFor="ai-model">
                        <HTMLSelect
                            id="ai-model"
                            options={
                                isLoadingModels
                                    ? [{ label: `Loading ${PROVIDERS.find((p) => p.value === form.provider)?.label || form.provider} models...`, value: "" }]
                                    : filteredModels.length > 0
                                        ? filteredModels
                                        : [{ label: form.provider === "codex-cli"
                                            ? "No Codex models available"
                                            : form.provider === "gemini-cli"
                                                ? "No Gemini models available"
                                                : ((form.apiKey.trim() || form.provider === "ollama") ? `No ${PROVIDERS.find((p) => p.value === form.provider)?.label || form.provider} models available` : `Enter API key to load ${PROVIDERS.find((p) => p.value === form.provider)?.label || form.provider} models`), value: "" }]
                            }
                            value={form.model}
                            disabled={isLoadingModels || filteredModels.length === 0}
                            onChange={(e) =>
                                setForm({ ...form, model: e.target.value })
                            }
                        />
                        {modelsError ? (
                            <div style={{ marginTop: "6px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                {modelsError}
                            </div>
                        ) : null}
                        {form.provider === "codex-cli" ? (
                            <div style={{ marginTop: "6px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                Codex model options are loaded dynamically. If Codex is already authenticated, the selected model is verified before the assistant is saved.
                            </div>
                        ) : form.provider === "gemini-cli" ? (
                            <div style={{ marginTop: "6px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                Gemini model options are loaded from the official model catalog (with safe local fallback) and used with your local Gemini CLI runtime.
                            </div>
                        ) : null}
                    </FormGroup>

                    <FormGroup label="Purpose" labelFor="ai-purpose">
                        <HTMLSelect
                            id="ai-purpose"
                            options={PURPOSES}
                            value={form.purpose}
                            disabled={["codex-cli", "gemini-cli", "ollama", "cloudflare"].includes(form.provider)}
                            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                        />
                    </FormGroup>

                    {form.purpose === "coding" && !["codex-cli", "gemini-cli"].includes(form.provider) ? (
                        <FormGroup label="First answer timeout (seconds)" labelFor="ai-first-response-timeout"
                            helperText="Maximum wait for answer text, including reasoning. Blank uses the provider default; 10–600 seconds. Stop remains available.">
                            <InputGroup id="ai-first-response-timeout" type="number" min="10" max="600" step="1"
                                placeholder={["cloudflare", "ollama"].includes(form.provider) ? "300" : "90"}
                                value={form.firstResponseTimeoutMs === "" ? "" : Number(form.firstResponseTimeoutMs) / 1000}
                                onChange={e => setForm({...form, firstResponseTimeoutMs: e.target.value === "" ? "" : Number(e.target.value) * 1000})} />
                        </FormGroup>
                    ) : null}

                    <FormGroup label="Default Thinking Mode" labelFor="ai-thinking-default">
                        <HTMLSelect
                            id="ai-thinking-default"
                            options={THINKING_DEFAULTS}
                            value={form.defaultThinkingMode || "auto"}
                            onChange={(e) => setForm({ ...form, defaultThinkingMode: e.target.value })}
                        />
                    </FormGroup>

                    {form.provider === "codex-cli" ? (
                        <>
                            <FormGroup label="Executable Path" labelFor="ai-codex-path">
                                <InputGroup
                                    id="ai-codex-path"
                                    placeholder="Optional: auto-detect 'codex' from PATH"
                                    value={form.executablePath}
                                    onChange={(e) => setForm({ ...form, executablePath: e.target.value })}
                                />
                            </FormGroup>
                            <div style={{ marginTop: "6px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                Uses your local Codex CLI login. This is intended for Coding Assistant only and works with packaged apps if the executable is installed and reachable.
                            </div>
                            <div style={{ marginTop: "4px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                Bundled Codex is only allowed when the detected bundled runtime passes the minimum safe version gate.
                            </div>
                        </>
                    ) : form.provider === "gemini-cli" ? (
                        <>
                            <FormGroup label="Executable Path" labelFor="ai-gemini-path">
                                <InputGroup
                                    id="ai-gemini-path"
                                    placeholder="Optional: auto-detect 'gemini' from PATH"
                                    value={form.executablePath}
                                    onChange={(e) => setForm({ ...form, executablePath: e.target.value })}
                                />
                            </FormGroup>
                            <div style={{ marginTop: "6px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px" }}>
                                Uses your local Gemini CLI runtime. This provider is intended for Coding Assistant workflows.
                            </div>
                        </>
                    ) : form.provider === "ollama" ? (
                        <>
                            <FormGroup label="Ollama server URL" labelFor="ai-ollama-url">
                                <InputGroup id="ai-ollama-url" value={form.baseUrl}
                                    onChange={e => setForm({...form, baseUrl: e.target.value})} />
                            </FormGroup>
                            <FormGroup label="Context length (tokens)" labelFor="ai-ollama-context"
                                helperText="Larger contexts need more memory. Screenshot requests require a model with vision support.">
                                <InputGroup id="ai-ollama-context" type="number" min="4096" max="262144" value={form.contextLength}
                                    onChange={e => setForm({...form, contextLength: e.target.value})} />
                            </FormGroup>
                            <p>Uses downloaded models on your Ollama server. No API key is needed.</p>
                        </>
                    ) : (
                        <FormGroup
                            label={form.provider === "cloudflare" ? "API Token" : "API Key"}
                            labelFor={"ai-key"}
                        >
                            <InputGroup
                                id="ai-key"
                                placeholder={form.provider === "cloudflare" ? "Cloudflare API token" : form.provider === "gemini" ? "Google AI Studio API key" : "sk-..."}
                                type="password"
                                value={form.apiKey}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setForm({
                                        ...form,
                                        apiKey: value,
                                    });
                                }}
                            />
                        </FormGroup>
                    )}

                </div>

                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button text="Cancel" onClick={() => setIsDialogOpen(false)} disabled={isLoading} />
                        <Button
                            intent="primary"
                            text="Add Assistant"
                            onClick={handleAdd}
                            loading={isLoading}
                            disabled={!form.model || !form.name.trim()}
                        />
                    </div>
                </div>
            </Dialog>
            <Dialog
                isOpen={codexAuthDialog.open}
                onClose={codexAuthDialog.loading ? undefined : closeCodexAuthDialog}
                title={`Manage ${authProviderLabel} Auth`}
                canEscapeKeyClose={!codexAuthDialog.loading}
                canOutsideClickClose={!codexAuthDialog.loading}
                style={{ width: "min(760px, calc(100vw - 24px))", maxWidth: "calc(100vw - 24px)" }}
            >
                <div className={`bp6-dialog-body ${styles["dialog-body-scroll"]}`}>
                    {codexAuthDialog.assistant ? (
                        <>
                            <div className={styles["dialog-metadata-row"]}>
                                <div className={styles["dialog-metadata-label"]}>Assistant:</div>
                                <div className={styles["dialog-metadata-value"]}>{codexAuthDialog.assistant.name}</div>
                                <div className={styles["dialog-metadata-label"]}>Executable:</div>
                                <div className={styles["dialog-metadata-value"]}>
                                    <span className={styles["dialog-code-value"]}>{codexAuthDialog.assistant.executablePath || "Auto-detected"}</span>
                                </div>
                                <div className={styles["dialog-metadata-label"]}>Runtime:</div>
                                <div className={styles["dialog-metadata-value"]}>
                                    <span className={styles["dialog-code-value"]}>
                                        {authRuntime?.source || "unknown"}
                                        {authRuntime?.version ? ` (${authRuntime.version})` : ""}
                                    </span>
                                </div>
                            </div>
                            <p className={styles["dialog-wrap-text"]} style={{ color: "var(--bp6-text-color-muted, #5f6b7c)" }}>
                                This is the runtime layer. Authentication state is tracked separately below.
                            </p>
                            <div className={styles["dialog-status-row"]}>
                                <b>Account:</b> <Tag intent={codexAuthIntent}>{formatCodexAuthLabel(codexAuthStatus)}</Tag>
                                {(codexAuthDialog.loading || codexAuthStatus === "pending") ? <Spinner size={16} /> : null}
                            </div>
                            {codexAuthDialog.assistant.codexAuth?.message ? (
                                <p className={styles["dialog-wrap-text"]} style={{ color: "var(--bp6-text-color-muted, #5f6b7c)" }}>
                                    {codexAuthDialog.assistant.codexAuth.message}
                                </p>
                            ) : null}
                            <p className={styles["dialog-wrap-text"]} style={{ color: "var(--bp6-text-color-muted, #5f6b7c)" }}>
                                {formatCheckedAt(codexAuthDialog.assistant.codexAuth?.checkedAt)}
                            </p>
                            {(codexAuthDialog.loading || codexAuthStatus === "pending") && codexActionLabel ? (
                                <p className={styles["dialog-wrap-text"]} style={{ color: "var(--bp6-text-color-muted, #5f6b7c)" }}>
                                    {codexActionLabel}
                                </p>
                            ) : null}
                            <p className={styles["dialog-wrap-text"]} style={{ color: "var(--bp6-text-color-muted, #5f6b7c)" }}>
                                {codexAuthDialog.assistant?.provider === "gemini-cli"
                                    ? (codexAuthStatus === "authorized"
                                        ? "Gemini authentication is active. You can refresh status at any time or sign out."
                                        : codexAuthStatus === "pending"
                                            ? "Complete the sign-in flow in Terminal, then click Check auth."
                                            : "Sign in opens Gemini in a terminal window. After completing the flow, click Check auth.")
                                    : (codexAuthStatus === "authorized"
                                        ? "Codex authentication is active. You can refresh status at any time or sign out."
                                        : codexAuthStatus === "pending"
                                            ? "Codex login is in progress in a background utility process. The dialog will keep syncing status automatically."
                                            : "Sign in starts Codex login in a background utility process. After login finishes, FDO will sync the new auth state automatically.")}
                            </p>
                        </>
                    ) : null}
                </div>
                <div className="bp6-dialog-footer">
                    <div className={`${styles["dialog-actions-nowrap"]} bp6-dialog-footer-actions`}>
                        <Button text="Check auth" icon="confirm" onClick={() => runCodexAuthAction("check")} loading={codexAuthDialog.loading && codexAuthDialog.action === "check"} disabled={!codexCanCheck} style={{ whiteSpace: "nowrap" }} />
                        <Button text="Cancel sign-in" icon="cross" onClick={() => runCodexAuthAction("cancel")} loading={codexAuthDialog.loading && codexAuthDialog.action === "cancel"} disabled={!codexCanCancel} style={{ whiteSpace: "nowrap" }} />
                        <Button text="Sign out" icon="log-out" onClick={() => runCodexAuthAction("logout")} loading={codexAuthDialog.loading && codexAuthDialog.action === "logout"} disabled={!codexCanSignOut} style={{ whiteSpace: "nowrap" }} />
                        <Button
                            intent={codexAuthStatus === "authorized" ? "success" : "primary"}
                            text={codexAuthStatus === "authorized" ? "Done" : codexAuthStatus === "pending" ? "Signing in..." : "Sign in"}
                            icon={codexAuthStatus === "authorized" ? "application" : "key"}
                            onClick={() => {
                                if (codexAuthStatus === "authorized") {
                                    closeCodexAuthDialog();
                                    AppToaster.show({ message: `${authProviderLabel} is ready to use in AI Coding Agent.`, intent: "success" });
                                    return;
                                }
                                runCodexAuthAction("login");
                            }}
                            loading={codexAuthDialog.loading && codexAuthDialog.action === "login"}
                            disabled={!codexCanPrimaryAction}
                            style={{ whiteSpace: "nowrap" }}
                        />
                    </div>
                </div>
            </Dialog>
        </div>
    );
}
