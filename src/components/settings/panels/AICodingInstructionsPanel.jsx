import React, {useEffect, useState} from "react";
import {Button, Card, FormGroup, H2, Spinner, TextArea} from "@blueprintjs/core";
import * as styles from "../../css/SettingsDialog.module.css";
import {AppToaster} from "../../AppToaster";

const PROVIDERS = [
    {label: "Gemini API (Google)", value: "gemini"},
    {label: "Cloudflare Workers AI", value: "cloudflare"},
    {label: "OpenAI", value: "openai"},
    {label: "Anthropic", value: "anthropic"},
    {label: "Ollama (local)", value: "ollama"},
    {label: "Codex CLI (ChatGPT)", value: "codex-cli"},
    {label: "Gemini CLI (Google)", value: "gemini-cli"},
];

export default function AICodingInstructionsPanel() {
    const [instructions, setInstructions] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const saved = await window.electron.settings.ai.getProviderInstructions?.();
                if (!cancelled && saved && typeof saved === "object") setInstructions(saved);
            } catch (error) {
                if (!cancelled) AppToaster.show({message: error.message || "Could not load coding provider instructions.", intent: "danger"});
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const save = async () => {
        if (typeof window.electron.settings.ai.setProviderInstructions !== "function") {
            AppToaster.show({message: "Coding provider instructions are unavailable in this app build.", intent: "warning"});
            return;
        }
        try {
            setIsSaving(true);
            const saved = await window.electron.settings.ai.setProviderInstructions(instructions);
            setInstructions(saved || {});
            AppToaster.show({message: "Coding provider instructions saved.", intent: "success"});
        } catch (error) {
            AppToaster.show({message: error.message || "Could not save coding provider instructions.", intent: "danger"});
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className={styles["card-panel"]}>
            <div className={styles["card-setting-header"]}>
                <H2 style={{margin: 0}}>Coding Instructions</H2>
            </div>
            <p style={{marginTop: 0, color: "var(--bp6-text-color-muted, #5f6b7c)"}}>
                Set standards for every AI Coding Agent request sent through each provider. Use these for team conventions, review criteria, preferred testing workflows, or response format.
            </p>
            <Card style={{padding: "16px"}}>
                {isLoading ? <Spinner /> : (
                    <>
                        {PROVIDERS.map((provider) => (
                            <FormGroup key={provider.value} label={provider.label} labelFor={`ai-provider-instructions-${provider.value}`}>
                                <TextArea
                                    id={`ai-provider-instructions-${provider.value}`}
                                    fill
                                    growVertically
                                    rows={4}
                                    maxLength={4000}
                                    placeholder="Optional instructions for this coding provider"
                                    value={instructions[provider.value] || ""}
                                    onChange={(event) => setInstructions((current) => ({
                                        ...current,
                                        [provider.value]: event.target.value,
                                    }))}
                                />
                            </FormGroup>
                        ))}
                        <p style={{marginBottom: "12px", color: "var(--bp6-text-color-muted, #5f6b7c)", fontSize: "12px"}}>
                            Plugin workspace boundaries, public SDK rules, and security constraints remain enforced for every provider.
                        </p>
                        <Button text="Save coding instructions" icon="floppy-disk" intent="primary" onClick={save} loading={isSaving} disabled={isSaving} />
                    </>
                )}
            </Card>
        </div>
    );
}
