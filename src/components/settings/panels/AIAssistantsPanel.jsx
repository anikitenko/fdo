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
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
]

const MODELS = [
    { label: "GPT-5", value: "gpt-5", provider: "openai" },
    { label: "GPT-4.1", value: "gpt-4.1", provider: "openai" },
    { label: "GPT-4.1-mini", value: "gpt-4.1-mini", provider: "openai" },
    { label: "GPT-4 Turbo", value: "gpt-4-turbo", provider: "openai" },
    { label: "GPT-4o", value: "gpt-4o", provider: "openai" },
    { label: "GPT-4o-mini", value: "gpt-4o-mini", provider: "openai" },
    { label: "GPT-3.5 Turbo", value: "gpt-3.5-turbo", provider: "openai" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001", provider: "anthropic" },
    { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5-20250929", provider: "anthropic" },
    { label: "Claude Opus 4.1", value: "claude-opus-4-1-20250805", provider: "anthropic" },
    { label: "Claude Opus 4", value: "claude-opus-4-20250514", provider: "anthropic" },
    { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514", provider: "anthropic" },
    { label: "Claude Sonnet 3.7", value: "claude-3-7-sonnet-20250219", provider: "anthropic" },
    { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022", provider: "anthropic" },
    { label: "Claude Haiku 3", value: "claude-3-haiku-20240307", provider: "anthropic" },
];

const PURPOSES = [
    { label: "Chat Assistant", value: "chat" },
    { label: "Coding Assistant", value: "coding" },
];

export default function AIAssistantsPanel() {
    const [assistants, setAssistants] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const [form, setForm] = useState({
        name: "",
        provider: "openai",
        model: "gpt-5",
        purpose: "chat",
        apiKey: ""
    });

    const filteredModels = MODELS.filter(
        (m) => m.provider === form.provider
    );

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
    }, []);

    const handleAdd = async () => {
        try {
            if (!form.name.trim()) throw new Error("Assistant name is required.");
            if (!form.apiKey.trim()) throw new Error("API key is required.");
            setIsLoading(true);
            form["default"] = true;
            await window.electron.settings.ai.addAssistant(form);
            AppToaster.show({
                message: `AI Assistant “${form.name}” added successfully.`,
                intent: "success",
            });

            // 🔄 Reload fresh list directly from settings to ensure consistency
            const updated = await window.electron.settings.ai.getAssistants();

            setAssistants(updated);

            setIsDialogOpen(false);
            setForm({
                name: "",
                provider: "openai",
                model: "gpt-5",
                purpose: "chat",
                apiKey: ""
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
                                <b>Model:</b> {MODELS.find((m) => m.value === a.model)?.label || a.model}
                            </p>
                            <p>
                                <b>Purpose:</b>{" "}
                                {PURPOSES.find((p) => p.value === a.purpose)?.label || a.purpose}
                            </p>
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

                    <FormGroup label="Model" labelFor="ai-provider">
                        <HTMLSelect
                            id="ai-provider"
                            options={PROVIDERS}
                            value={form.provider}
                            onChange={(e) => {
                                const provider = e.target.value;
                                // reset model when provider changes
                                setForm({
                                    ...form,
                                    provider,
                                    model: "",
                                });
                            }}
                        />
                    </FormGroup>

                    <FormGroup label="Model" labelFor="ai-model">
                        <HTMLSelect
                            id="ai-model"
                            options={filteredModels.length > 0
                                ? filteredModels
                                : [{ label: "No models available", value: "" }]}
                            value={form.model}
                            onChange={(e) =>
                                setForm({ ...form, model: e.target.value })
                            }
                        />
                    </FormGroup>

                    <FormGroup label="Purpose" labelFor="ai-purpose">
                        <HTMLSelect
                            id="ai-purpose"
                            options={PURPOSES}
                            value={form.purpose}
                            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                        />
                    </FormGroup>

                    {/* AI Key Input */}
                    <FormGroup
                        label="API Key"
                        labelFor={"ai-key"}
                    >
                        <InputGroup
                            id="ai-key"
                            placeholder="sk-..."
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

                </div>

                <div className="bp6-dialog-footer">
                    <div className="bp6-dialog-footer-actions">
                        <Button text="Cancel" onClick={() => setIsDialogOpen(false)} disabled={isLoading} />
                        <Button
                            intent="primary"
                            text="Add Assistant"
                            onClick={handleAdd}
                            loading={isLoading}
                        />
                    </div>
                </div>
            </Dialog>
        </div>
    );
}
