import React, {useCallback, useEffect, useState} from 'react';
import {Button, Callout, Card, HTMLSelect, H4, Intent, Spinner, Switch} from '@blueprintjs/core';
import Markdown from 'markdown-to-jsx';

const formatReleaseNotes = value => String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\*\*Unsigned prerelease builds:\*\*\s*win-x64\.\s*macOS Gatekeeper and Windows SmartScreen may block these builds\./gi, 'Windows installers are published unsigned.')
    .replace(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, '\n### $1\n')
    .replace(/<\/details\s*>/gi, '\n')
    .replace(/<\/?summary\b[^>]*>/gi, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();

export const UpdatesPanel = ({checkOnOpen = false, checkRequestId}) => {
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState(null);
    const [preferences, setPreferences] = useState({autoCheck: false, channel: 'stable'});
    const [preferencesLoaded, setPreferencesLoaded] = useState(false);

    const checkForUpdates = useCallback(async (channel = preferences.channel) => {
        setChecking(true);
        setResult(null);
        try {
            setResult(await window.electron.settings.updates.check(channel));
        } catch (error) {
            setResult({success: false, error: error.message || 'Could not check for updates.'});
        } finally {
            setChecking(false);
        }
    }, [preferences.channel]);

    useEffect(() => {
        let active = true;
        window.electron.settings.updates.getPreferences().then(saved => {
            if (!active) return;
            const next = {autoCheck: !!saved?.autoCheck, channel: saved?.channel === 'prerelease' ? 'prerelease' : 'stable'};
            setPreferences(next);
            setPreferencesLoaded(true);
        }).catch(() => setPreferencesLoaded(true));
        return () => {active = false;};
    }, []);

    useEffect(() => {
        if (preferencesLoaded && (checkOnOpen || preferences.autoCheck)) void checkForUpdates(preferences.channel);
    }, [checkOnOpen, checkRequestId, preferencesLoaded]);

    const savePreferences = async next => {
        setPreferences(next);
        try {
            await window.electron.settings.updates.savePreferences(next);
            if (next.autoCheck && preferencesLoaded) void checkForUpdates(next.channel);
        } catch (error) {
            setResult({success: false, error: error.message || 'Could not save update preferences.'});
        }
    };

    const openDownload = url => window.electron.system.openExternal(url);
    const openRelease = () => result?.releaseUrl && openDownload(result.releaseUrl);
    const openMarkdownLink = ({href, children}) => <a href={href} onClick={event => {
        event.preventDefault();
        if (/^https:\/\//i.test(href || '')) openDownload(href);
    }}>{children}</a>;

    return <div style={{padding: 20, maxWidth: 760, overflowY: 'auto', height: '100%', minHeight: 0, boxSizing: 'border-box'}}>
        <H4>Software Updates</H4>
        <Card style={{marginBottom: 16}}>
            <p>Check GitHub Releases for FDO updates. Download the installer for this computer and install it yourself.</p>
            <Switch
                checked={preferences.autoCheck}
                disabled={!preferencesLoaded}
                label="Automatically check when Settings opens"
                onChange={event => savePreferences({...preferences, autoCheck: event.target.checked})}
            />
            <div style={{display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0'}}>
                <span>Release channel</span>
                <HTMLSelect
                    value={preferences.channel}
                    disabled={!preferencesLoaded}
                    onChange={event => savePreferences({...preferences, channel: event.target.value})}
                    options={[{label: 'Stable', value: 'stable'}, {label: 'Prerelease', value: 'prerelease'}]}
                />
                <Button intent={Intent.PRIMARY} icon="refresh" onClick={() => checkForUpdates()} disabled={checking || !preferencesLoaded}>
                    {checking ? 'Checking…' : 'Check for Updates'}
                </Button>
            </div>
        </Card>
        {checking && <Spinner size={20}/>}
        {result?.success && <>
            <Callout intent={result.hasUpdate ? Intent.PRIMARY : Intent.SUCCESS}
                     title={result.hasUpdate ? `Version ${result.latestVersion} is available` : `FDO is up to date (${result.currentVersion})`}>
                {result.releaseName && <p>{result.releaseName}</p>}
                {result.hasUpdate && result.downloads?.length > 0 && <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
                    {result.downloads.map((download, index) => <Button key={download.name} icon="download" onClick={() => openDownload(download.url)}>
                        {index === 0 ? `Download for ${result.platform}` : `Download ${download.name}`}
                    </Button>)}
                </div>}
                {result.hasUpdate && !result.downloads?.length && <p>{result.platform?.startsWith('win-')
                    ? 'No Windows installer was found for this architecture. Open the release page to see available downloads. Windows installers are published unsigned.'
                    : 'No installer was found for this OS and architecture. Open the release page to see available downloads.'}</p>}
                {result.hasUpdate && <p>After downloading, open the installer and follow its prompts to update FDO.</p>}
                <Button variant={"minimal"} icon="share" onClick={openRelease}>View GitHub release</Button>
            </Callout>
            {!!result.releaseNotes && <Card style={{marginTop: 12, maxHeight: 300, overflow: 'auto'}}>
                <H4>Latest Release Notes{result.latestVersion ? ` · ${result.latestVersion}` : ''}</H4>
                <div className="bp6-text-small" style={{overflowWrap: 'anywhere'}}>
                    <Markdown options={{disableParsingRawHTML: true, overrides: {a: {component: openMarkdownLink}}}}>{formatReleaseNotes(result.releaseNotes)}</Markdown>
                </div>
            </Card>}
        </>}
        {result && !result.success && <Callout intent={Intent.DANGER} title="Could not check for updates">{result.error}</Callout>}
    </div>;
};

UpdatesPanel.defaultProps = {checkOnOpen: false};
export default UpdatesPanel;
