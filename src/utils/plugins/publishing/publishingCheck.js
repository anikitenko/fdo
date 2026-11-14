import {isUtf8} from 'node:buffer';
import {sourcePathProblem, sourceFileProblem} from './registryPolicy/archive-path';
import {validateSourceFiles, MAX_ENTRIES, MAX_FILE_BYTES, MAX_EXPANDED_BYTES} from './registryPolicy/source-archive';
import provenance from './registryPolicy/provenance.json';
import {scanTypeScript} from './registryPolicy/typescript-security';

const CAPABILITY_FORMS = [
    "Supported forms: string literals, constants (const / readonly fields), spreads of those, and SDK helpers imported from '@anikitenko/fdo-sdk' called with constant arguments.",
    "Helpers: createFilesystemScopeCapability, createProcessScopeCapability, createNetworkScopeCapability, create{Capability,Filesystem,Process,Workflow,Storage,AI,Secrets,SSH}CapabilityBundle, createOperatorToolCapabilityPreset, createAICapabilityPreset, createStorageCapabilityPreset, sharedLogicCapability, and createNetworkCapabilityBundle({transports: ['https'], scopeId: 'my-scope'}).",
];
const GUIDANCE = [
    [/Cannot resolve FDO capabilities/, [
        'The registry derives capabilities by reading your source; it never runs plugin or SDK code, so every value must be statically resolvable.',
        'Replace values computed at runtime (process.env, Math.random, your own functions, constructor arguments, mutable `let` variables, other runtime calls) with constants.',
        'Make sure the referenced constant is declared with `const` (or a readonly class field) inside the archive, and that SDK helpers are imported from @anikitenko/fdo-sdk and not redefined locally.',
        ...CAPABILITY_FORMS]],
    [/declareCapabilities\(\) must contain only optional const/, [
        'Keep declareCapabilities() to optional `const` declarations followed by a single final `return`. Remove if/loops/other statements.',
        'Move conditional logic out: declare every capability the plugin may need; the host still decides what is granted.']],
    [/one statically inspectable declareCapabilities/, [
        'Declare declareCapabilities() exactly once as a class method with a body in the plugin entry file.']],
    [/Network capabilities|HTTP\/HTTPS transports|Network transports|Network scopeId|createNetworkCapabilityBundle/, [
        "Call createNetworkCapabilityBundle with an inline object: transports: ['http' | 'https'] (unique, non-empty) and scopeId: a lowercase string matching [a-z0-9-], max 63 chars."]],
    [/metadata or complete package metadata is required/, ['Add the missing fields (e.g. author, description) to package.json, or declare them in the plugin metadata.']],
    [/ambiguous metadata declarations/, ['Declare each FDO metadata field (name, version, author, etc.) once, using constant values.']],
    [/package\.json name cannot be converted/, ['Set a package.json "name" containing letters or digits, e.g. "my-company-plugin".']],
    [/is reserved for examples/, ['Rename the package in package.json to a distinctive name.']],
    [/Set package\.json source/, ['Add "source": "index.ts" to package.json or place index.ts / src/index.ts in the plugin root.']],
    [/fdo\.compatibility/, ['Add "fdo": {"compatibility": {"fdo": ">=1.0.0", "sdk": "^1.0.0", "api": "^1.0.0"}} to package.json using valid semver ranges.']],
    [/Only versioned host-provided/, ['Keep only @anikitenko/fdo-sdk, react and react-dom in dependencies, pinned like "^1.2.3".']],
    [/version conflicts/, ['Make package.json "version" equal the version declared in the plugin metadata.']],
];

export function explainPublishingError(message) {
    const hint = GUIDANCE.find(([pattern]) => pattern.test(message));
    return hint ? `${message}\n  How to fix:\n${hint[1].map((line, i) => `    ${i + 1}. ${line}`).join('\n')}` : message;
}

// This consumes inert source data only. Registry validation never imports or runs a plugin.
export function checkPublishingFiles(files) {
    const errors = [], names = new Set(), text = new Map();
    const entries = Object.entries(files);
    let total = 0;
    if (entries.length + 2 > MAX_ENTRIES) errors.push('Registry archives allow at most 1,000 files including signing files.');
    for (const [name, value] of entries) {
        const problem = sourcePathProblem(name) || sourceFileProblem(name, true);
        if (problem) errors.push(problem);
        if (names.has(name.toLowerCase())) errors.push(`Case-colliding source path: ${JSON.stringify(name)}`);
        names.add(name.toLowerCase());
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        total += bytes.length;
        if (bytes.length > MAX_FILE_BYTES) errors.push(`File exceeds 1 MiB: ${JSON.stringify(name)}`);
        if (!isUtf8(bytes) || bytes.includes(0)) errors.push(`Binary or non-UTF-8 source: ${JSON.stringify(name)}`);
        if (name === 'fdo.meta.json' || name === 'fdo.signature') errors.push('Remove stale signing files before checking the publishing source copy.');
        text.set(name, bytes.toString('utf8'));
    }
    if (total > MAX_EXPANDED_BYTES) errors.push('Registry source exceeds 32 MiB.');
    let proposal;
    if (!errors.length) {
        try {
            const archive = validateSourceFiles(Buffer.alloc(0), text, undefined, true);
            proposal = archive.proposal;
            const security = scanTypeScript({...archive, manifest: {...archive.manifest, capabilities: proposal?.capabilities || []}});
            errors.push(...security.findings.map(finding => `${finding.code}: ${finding.message}`));
        }
        catch (error) {errors.push(explainPublishingError(error.message));}
    }
    return {valid: !errors.length, errors, fileCount: entries.length, sourceBytes: total,
        ...(proposal ? {proposal} : {}), policy: provenance,
        notes: ['Local source preflight only. The registry rechecks signatures, certificate status, account ownership, reserved IDs, release versions and server-side scans on upload.']};
}

export function requirePublishingFiles(files) {
    const report = checkPublishingFiles(files);
    if (!report.valid) throw Object.assign(new Error('Registry publishing check failed:\n' + report.errors.map(error => `- ${error}`).join('\n')), {code: 'PUBLISHING_CHECK_FAILED', report});
    return report;
}
