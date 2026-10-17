import {load, JSON_SCHEMA} from 'js-yaml';

export const MAX_MANIFEST_BYTES = 256 * 1024;

function record(value, field, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new Error(`${field}.${key} is not supported.`);
    }
}

function text(value, field, max = 2048) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
        throw new Error(`${field} must be a nonempty string (at most ${max} characters).`);
    }
    return value;
}

export function repositoryUrl(value) {
    text(value, 'Repository URL');
    let url;
    try { url = new URL(value); } catch { throw new Error('Use an HTTPS Git repository URL.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname === '/') {
        throw new Error('Use an HTTPS Git repository URL without embedded credentials, query parameters, or fragments.');
    }
    return url.href.replace(/\/$/, '');
}

export function revision(value, field = 'Revision') {
    text(value, field, 255);
    if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.') ||
        /[\s~^:?*\[\\]/.test(value) || value.includes('..') || value.includes('@{') || value === '@' ||
        value.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
        throw new Error(`${field} must be a valid Git branch, tag, or commit reference.`);
    }
    return value;
}

export function repositoryPath(value, {root = false, field = 'Manifest path'} = {}) {
    text(value, field, 1024);
    const clean = root ? value.replace(/^\//, '') : value;
    if ((clean === '' && root) || (clean === '.' && root)) return '';
    if (clean.startsWith('/') || clean.includes('\\') || clean.includes(':') ||
        clean.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
        throw new Error(`${field} must be a path inside the repository without traversal segments.`);
    }
    return clean;
}

function name(value, field) {
    text(value, field, 63);
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) throw new Error(`${field} must use lowercase letters, numbers, and hyphens.`);
}

export function validateCollection(source) {
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('Manifest must be at most 256 KiB.');
    let manifest;
    try { manifest = load(source, {schema: JSON_SCHEMA}); }
    catch { throw new Error('Manifest is invalid YAML. Use one document with unique mapping keys.'); }
    record(manifest, 'Manifest', ['apiVersion', 'kind', 'metadata', 'spec']);
    if (manifest.apiVersion !== 'fdo.dev/v1alpha1') throw new Error('apiVersion must be fdo.dev/v1alpha1.');
    if (manifest.kind !== 'PluginCollection') throw new Error('kind must be PluginCollection.');
    const meta = manifest.metadata;
    record(meta, 'metadata', ['name', 'displayName', 'description', 'version', 'maintainers']);
    name(meta.name, 'metadata.name');
    for (const field of ['displayName', 'description']) if (meta[field] !== undefined) text(meta[field], `metadata.${field}`);
    text(meta.version, 'metadata.version', 128);
    const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(meta.version);
    if (!version || version[4]?.split('.').some(part => /^0\d+$/.test(part))) {
        throw new Error('metadata.version must be a semantic version such as 1.2.0.');
    }
    if (meta.maintainers !== undefined) {
        if (!Array.isArray(meta.maintainers) || meta.maintainers.length > 50) throw new Error('metadata.maintainers must be an array of at most 50 entries.');
        meta.maintainers.forEach((maintainer, index) => {
            record(maintainer, `metadata.maintainers[${index}]`, ['github']);
            text(maintainer.github, `metadata.maintainers[${index}].github`, 39);
            if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(maintainer.github)) throw new Error('Maintainer github must be a GitHub username.');
        });
    }
    record(manifest.spec, 'spec', ['plugins']);
    const plugins = manifest.spec.plugins;
    if (!Array.isArray(plugins) || plugins.length < 1 || plugins.length > 100) throw new Error('spec.plugins must contain between 1 and 100 plugins.');
    const names = new Set();
    plugins.forEach((plugin, index) => {
        const field = `spec.plugins[${index}]`;
        record(plugin, field, ['name', 'repository', 'targetRevision', 'path']);
        name(plugin.name, `${field}.name`);
        if (names.has(plugin.name)) throw new Error(`Duplicate plugin name: ${plugin.name}.`);
        names.add(plugin.name);
        repositoryUrl(plugin.repository);
        revision(plugin.targetRevision, `${field}.targetRevision`);
        repositoryPath(plugin.path, {root: true, field: `${field}.path`});
    });
    return manifest;
}

export function validateRepository(input) {
    if (!input || typeof input !== 'object') throw new Error('Repository details are required.');
    const url = repositoryUrl(input.url?.trim());
    const targetRevision = revision(input.targetRevision?.trim());
    const manifestPath = repositoryPath(input.manifestPath?.trim());
    if (!['branch', 'tag'].includes(input.revisionType)) throw new Error('Choose a branch or release tag.');
    if (!['none', 'basic'].includes(input.authType)) throw new Error('Choose an authentication method.');
    if (input.authType === 'basic') {
        text(input.username, 'Username', 256);
        text(input.password, 'Token / password', 8192);
        if (input.username.includes(':')) throw new Error('Username cannot contain a colon.');
    }
    return {url, targetRevision, manifestPath, revisionType: input.revisionType, authType: input.authType};
}
