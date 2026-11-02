import React, {useEffect, useRef, useState} from 'react';
import {Button, Callout, Dialog, DialogBody, DialogFooter, FormGroup, HTMLSelect} from '@blueprintjs/core';
import Markdown from 'markdown-to-jsx';
import azure from '../../../docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md';
import aws from '../../../docs/AWS_ECS_DEPLOYMENT.md';
import gcp from '../../../docs/GCP_CLOUD_RUN_DEPLOYMENT.md';
import * as styles from './DeploymentGuideDialog.module.css';

export const DEPLOYMENT_GUIDES = {
    azure: {label: 'Azure Container Apps', file: 'docs/AZURE_CONTAINER_APPS.md', source: azure},
    aws: {label: 'AWS ECS Fargate', file: 'docs/AWS_ECS.md', source: aws},
    gcp: {label: 'Google Cloud Run', file: 'docs/GCP_CLOUD_RUN.md', source: gcp},
};

function guideLink({href, children}) {
    return <a href={href} onClick={event => {
        event.preventDefault();
        if (/^https:\/\//i.test(href || '')) window.electron.system.openExternal(href);
    }}>{children}</a>;
}

function textContent(value) {
    if (typeof value === 'string') return value;
    return React.Children.toArray(value).map(item => React.isValidElement(item) ? textContent(item.props.children) : String(item ?? '')).join('');
}

function CommandBlock({children}) {
    const [status, setStatus] = useState('');
    return <div className={styles.codeBlock}>
        <div className={styles.codeToolbar}><Button size="small" icon="clipboard" onClick={async () => {
            try {await navigator.clipboard.writeText(textContent(children));setStatus('Copied');}
            catch {setStatus('Select the code below to copy it.');}
        }}>Copy code</Button><span role="status">{status}</span></div>
        <pre tabIndex={0}>{children}</pre>
    </div>;
}

const markdownOptions = {disableParsingRawHTML: true, forceBlock: true, overrides: {a: guideLink, pre: CommandBlock}};

export default function DeploymentGuideDialog({provider, onProviderChange, onClose, port}) {
    const guide = DEPLOYMENT_GUIDES[provider] || DEPLOYMENT_GUIDES.azure;
    const content = useRef(null);
    const [copyStatus, setCopyStatus] = useState('');
    useEffect(() => {setCopyStatus('');content.current?.scrollTo?.(0, 0);}, [provider]);
    const sections = [...guide.source.matchAll(/^## (.+)$/gm)].map(match => match[1]);
    return <Dialog isOpen={!!provider} title="Cloud deployment guide" onClose={onClose} className="bp6-dark"
        style={{width: 1000, maxWidth: 'calc(100vw - 32px)', height: 'min(900px, calc(100vh - 48px))'}}>
        <DialogBody className={styles.body} useOverflowScrollContainer={false}>
            <div className={styles.controls}>
                <FormGroup label="Deployment platform" labelFor="deployment-guide-provider">
                    <HTMLSelect fill id="deployment-guide-provider" value={provider || 'azure'} onChange={event => onProviderChange(event.target.value)}
                        options={Object.entries(DEPLOYMENT_GUIDES).map(([value, item]) => ({value, label: item.label}))}/>
                </FormGroup>
                <FormGroup label="Jump to section" labelFor="deployment-guide-section">
                    <HTMLSelect fill id="deployment-guide-section" key={provider} defaultValue="" onChange={event => {
                        if (event.target.value !== '') content.current?.querySelectorAll('h2')[Number(event.target.value)]?.scrollIntoView?.({block: 'start'});
                    }} options={[{value: '', label: 'Overview'}, ...sections.map((label, index) => ({value: String(index), label}))]}/>
                </FormGroup>
            </div>
            <Callout icon="info-sign" className={styles.note}>
                Follow from the extracted export folder. Selected container port: <strong>{port}</strong>. These reference commands create cloud resources only when you run them; this dialog does not execute commands or sign in.
                <div>Included in the ZIP: <code>{guide.file}</code>.</div>
            </Callout>
            <section ref={content} className={styles.content} aria-label={guide.label + ' deployment instructions'} tabIndex={0}>
                <Markdown key={provider} options={markdownOptions}>{guide.source}</Markdown>
            </section>
        </DialogBody>
        <DialogFooter actions={<>
            <span role="status">{copyStatus}</span>
            <Button icon="clipboard" onClick={async () => {
                try {await navigator.clipboard.writeText(guide.source);setCopyStatus('Guide copied.');}
                catch {setCopyStatus('Could not copy. The guide is also included in the exported ZIP.');}
            }}>Copy full guide</Button>
            <Button onClick={onClose}>Close guide</Button>
        </>}/>
    </Dialog>;
}
