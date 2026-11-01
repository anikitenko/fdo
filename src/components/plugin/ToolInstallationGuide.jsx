import React, {useState} from 'react';
import {Button, Callout, Dialog, DialogBody, DialogFooter, HTMLSelect} from '@blueprintjs/core';
import * as styles from './ToolInstallationGuide.module.css';

const recipes = {
    catalog: {
        label: 'Catalog tool', title: 'Use an existing tool recipe',
        description: 'Choose this when the tool is available in the Live UI tool catalog. FDO supplies its installer and version check.',
        steps: ['Open Live UI editor → Deployment requirements → Manage deployment requirements.', 'Choose a catalog tool, add it, and set its required version if needed.', 'Preview and apply the reviewed package.json change.'],
        example: {fdo: {deployment: {schemaVersion: 1, tools: [{id: 'jq', version: '>=1.6 <2'}]}}},
        note: 'Example only: add jq only if the plugin runs it. HTTP APIs and JavaScript packages need no CLI declaration.',
    },
    apt: {
        label: 'Debian package', title: 'Install from a Debian repository',
        description: 'Use for a tool distributed as a package in a repository configured in your base image. The default image uses Debian bookworm.',
        steps: ['In Manage deployment requirements, choose Add custom tool → Debian package.', 'Enter the command basename, installed executable path, package names and a non-mutating version command.', 'Use package=debian-version for an exact package pin when available. Repositories must already be configured; use a custom image for vendor repository setup.'],
        example: {fdo: {deployment: {schemaVersion: 1, tools: [{id: 'postgres-client', command: 'psql', version: '>=15 <16', executable: '/usr/bin/psql', versionArgs: ['--version'], installer: {type: 'apt', packages: ['postgresql-client-15']}}]}}},
        note: 'Package names are installation inputs, not shell commands. Do not paste apt-get commands into the packages field.',
    },
    artifact: {
        label: 'Binary or archive download', title: 'Install one verified executable',
        description: 'Use for a standalone Linux executable, or one executable inside a .tar.gz or .zip archive. For a multi-file SDK, choose Custom image instead.',
        steps: ['Choose Add custom tool → Verified executable artifact. Enable each Linux architecture you will deploy.', 'Use the publisher’s public HTTPS release URL and verify its SHA-256 against trusted release information. URLs must not contain credentials or query strings.', 'Select file, tar.gz or zip. For an archive, enter the exact executable member path, such as bin/example-tool. Only that file is copied to /opt/fdo-tools/bin/<command>.'],
        example: {fdo: {deployment: {schemaVersion: 1, tools: [{id: 'example-tool', command: 'example-tool', version: '1.2.3', versionArgs: ['--version'], installer: {type: 'artifact', platforms: {'linux/amd64': {url: 'https://publisher.example/releases/1.2.3/tool-linux-amd64.tar.gz', sha256: 'REPLACE_WITH_PUBLISHER_VERIFIED_SHA256', format: 'tar.gz', member: 'bin/example-tool'}}}}]}}},
        note: 'Template: replace the example URL and hash before previewing. Add linux/arm64 with its own artifact and hash for ARM builds. Downloads and checksum checks run during image build.',
    },
    image: {
        label: 'Custom image / vendor installer', title: 'Prepare a base image with the tool installed',
        description: 'Use when a tool needs a vendor installer, extra repositories, plugins, libraries, several executables or a full SDK directory.',
        steps: ['In your own image pipeline, extend node:24-bookworm-slim and follow the vendor’s Linux installation instructions. Pin and verify the vendor inputs. Preserve Node 24, npm and the node user; make the executable runnable by that user.', 'Build, test and publish the base image for your target CPU architecture. Record its actual OCI sha256 digest.', 'In Manage deployment requirements, select Provided by image for the custom tool. Enter its absolute executable path and version check. Set Custom base image to the published image reference with its digest.'],
        example: {fdo: {deployment: {schemaVersion: 1, baseImage: 'registry.example/team/node24-tools@sha256:REPLACE_WITH_64_CHARACTER_IMAGE_DIGEST', tools: [{id: 'example-sdk', command: 'example-cli', version: '>=1 <2', executable: '/opt/example-sdk/bin/example-cli', versionArgs: ['--version'], installer: {type: 'provided'}}]}}},
        note: 'Template: replace the image, digest, command and path. Shell installer snippets are not accepted in tool declarations. “Provided” still checks that the executable exists and its version matches. Keep credentials and login out of image builds.',
    },
};

export function ToolInstallationGuide({disabled = false}) {
    const [open, setOpen] = useState(false), [method, setMethod] = useState('catalog');
    const [copyStatus, setCopyStatus] = useState('');
    const recipe = recipes[method];
    return <>
        <Button icon="manual" disabled={disabled} onClick={() => {setCopyStatus(''); setOpen(true);}}>Installation guide</Button>
        <Dialog isOpen={open} onClose={() => setOpen(false)} title="Container tool installation guide" className="bp6-dark" style={{width: 840, maxWidth: 'calc(100vw - 32px)'}}>
            <DialogBody className={styles.body}>
                <p className={styles.intro}>Declare what the plugin runs. Docker installs and checks it when you build the exported application.</p>
                <section aria-label="Choose an installation method">
                    <label className={styles.label} htmlFor="tool-installation-method">How is the tool distributed?</label>
                    <HTMLSelect id="tool-installation-method" fill value={method} options={Object.entries(recipes).map(([value, item]) => ({value, label: item.label}))} onChange={event => {setMethod(event.target.value); setCopyStatus('');}}/>
                    <h3>{recipe.title}</h3>
                    <p>{recipe.description}</p>
                    <ol className={styles.steps}>{recipe.steps.map(step => <li key={step}>{step}</li>)}</ol>
                </section>
                <section aria-label="Package declaration example" className={styles.example}>
                    <div className={styles.exampleHeader}><strong>package.json · merge into existing fields</strong><Button size={"small"} icon="clipboard" onClick={async () => {
                        try {await navigator.clipboard.writeText(JSON.stringify(recipe.example, null, 2)); setCopyStatus('Example copied. Merge it without replacing existing fields or tools.');}
                        catch {setCopyStatus('Could not copy. Select and copy the example below.');}
                    }}>Copy example</Button></div>
                    <pre tabIndex={0}>{JSON.stringify(recipe.example, null, 2)}</pre>
                    <p>{recipe.note}</p>
                    {copyStatus && <p role="status">{copyStatus}</p>}
                </section>
                {method === 'image' && <section aria-label="Custom image build example">
                    <h3>Example base-image Dockerfile</h3>
                    <p>Template for a reviewed SDK directory already downloaded in your image build context. Add the vendor’s required Linux libraries and setup steps before switching to the node user.</p>
                    <pre className={styles.command}>{'FROM node:24-bookworm-slim\nUSER root\nCOPY vendor-sdk/ /opt/example-sdk/\nRUN chmod 0755 /opt/example-sdk/bin/example-cli\nUSER node\nRUN /opt/example-sdk/bin/example-cli --version'}</pre>
                    <p>Build and publish this base image separately. Use the digest reported by your registry in <code>fdo.deployment.baseImage</code>, then export the application. Match the architecture to your SDK files.</p>
                    <pre className={styles.command}>docker buildx build --platform linux/amd64 -t YOUR_REGISTRY/node24-tools:1 --push .</pre>
                </section>}
                <section aria-label="Build and verify">
                    <h3>Finish and verify</h3>
                    <ol className={styles.steps}>
                        <li>Save and deploy the plugin. For a GitOps plugin, commit the declaration to its source repository and synchronize it.</li>
                        <li>Return to Export As → Review installed version, export again, and extract the ZIP.</li>
                        <li>Run <code>sh start.sh</code> to build and start the application. Then check the installed tools:</li>
                    </ol>
                    <pre className={styles.command}>docker compose exec application node tools.cjs check</pre>
                    <p>If the app cannot start, build the image first, then run <code>docker compose run --rm --no-deps application node tools.cjs check</code>.</p>
                    <details><summary>Troubleshooting installation</summary><ul className={styles.steps}>
                        <li><strong>Package not found:</strong> check the package name and configured Debian repositories.</li>
                        <li><strong>Missing platform:</strong> supply an artifact or base image for the selected Linux CPU architecture.</li>
                        <li><strong>Checksum mismatch:</strong> verify the download against the publisher’s release; correct the URL or hash before rebuilding.</li>
                        <li><strong>Version or executable mismatch:</strong> verify the path and version command inside the image.</li>
                        <li><strong>Permission denied when running a tool:</strong> review the plugin’s process scope and arguments as well as file execution permissions.</li>
                    </ul></details>
                    <Callout icon="info-sign" className={styles.boundary}>Installation, plugin permissions and service authentication are separate steps. Configure tokens, cloud login and resource roles at runtime. The exported ZIP also includes <code>docs/TOOLCHAIN.md</code>.</Callout>
                </section>
            </DialogBody>
            <DialogFooter actions={<Button onClick={() => setOpen(false)}>Close guide</Button>}/>
        </Dialog>
    </>;
}

export default function ContainerToolSetup() {
    const [hidden, setHidden] = useState(false);
    if (hidden) return null;
    return <section aria-label="Container tool setup" className={styles.bar}>
        <div><strong>Container tool requirements</strong><p>Edit <code>package.json → fdo.deployment.tools</code>. Add only CLI tools the plugin runs.</p></div>
        <div className={styles.actions}><ToolInstallationGuide/><Button variant={"minimal"} aria-label="Hide tool setup guidance" icon="cross" onClick={() => setHidden(true)}/></div>
    </section>;
}
