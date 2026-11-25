import React, {useState} from 'react';
import {Button, Callout} from '@blueprintjs/core';

export default function CodexSetup({assistant, onRefresh}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const choose = async () => {
        setBusy(true);
        setError('');
        try {
            await window.electron.settings.ai.chooseCodexExecutable(assistant.id);
            await onRefresh();
        } catch (reason) {setError(reason.message);}
        finally {setBusy(false);}
    };
    const runtime = assistant.codexRuntime;
    return <Callout title="Local Codex CLI">
        <p>{runtime?.version && !runtime.bundled ? `Connected to Codex ${runtime.version}` : runtime?.message || 'Install Codex CLI or choose an existing installation.'}</p>
        <Button text="Installation guide" onClick={() => window.electron.system.openExternal('https://developers.openai.com/codex/cli/')}/>
        <Button text="Test Codex CLI" disabled={busy} onClick={onRefresh}/>
        <Button text="Browse for Codex CLI…" loading={busy} onClick={choose}/>
        {error && <p role="alert">{error}</p>}
    </Callout>;
}
