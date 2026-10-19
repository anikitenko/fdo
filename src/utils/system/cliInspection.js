import fs from 'node:fs';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {readCliRegistry} from './cliPluginOperations';

function activatedPlugins(file) {
    if (!fs.existsSync(file)) return [];
    const ids = JSON.parse(fs.readFileSync(file, 'utf8'))?.config?.plugins ?? [];
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error(`Invalid activation configuration: ${file}`);
    return ids;
}

export async function inspectCliPlugins({registryFile, configFile, verifyPlugin}, id) {
    const registry = readCliRegistry(registryFile);
    if (registry.plugins.some(plugin => !plugin || typeof plugin.id !== 'string' || typeof plugin.home !== 'string')) throw new Error(`Invalid plugin records in ${registryFile}`);
    const selected = id === undefined ? registry.plugins : registry.plugins.filter(plugin => plugin.id === id);
    if (id !== undefined && !selected.length) throw new Error(`Plugin not found: ${id}`);
    const activated = activatedPlugins(configFile);
    return Promise.all(selected.map(async plugin => {
        let signature;
        try {
            const result = await verifyPlugin(plugin.home);
            signature = {status: result.success ? 'valid' : 'invalid', ...(result.success ? {} : {error: result.error || 'Signature verification failed.'})};
        } catch (error) {signature = {status: 'invalid', error: error.message};}
        return {id: plugin.id, name: plugin.metadata?.name || plugin.id, version: plugin.metadata?.version || null,
            enabled: activated.includes(plugin.id), home: plugin.home, entry: plugin.entry || null,
            capabilities: plugin.capabilities || [], customProcessScopes: plugin.customProcessScopes || [],
            customFilesystemScopes: plugin.customFilesystemScopes || [], gitops: !!plugin.gitops, signature};
    }));
}

// Diagnostics use public certificate metadata only; never decrypt private keys.
export async function diagnoseCli({version, profile, registryFile, configFile, installation, listCertificates, credentialStoreAvailable, now = new Date()}) {
    const checks = [];
    const check = async (id, run, fix) => {
        try {checks.push({id, ...await run()});}
        catch (error) {checks.push({id, status: 'error', message: error.message, fix});}
    };
    await check('installation', () => ({status: 'ok', message: `FDO ${version}` }));
    await check('wrapper', async () => {
        const result = await installation();
        return {status: result.current ? 'ok' : 'warning', message: result.current ? `CLI wrapper is current: ${result.path}` : 'CLI wrapper is missing or outdated.',
            ...(result.current ? {} : {fix: 'Use Settings → General → Enable terminal command / Repair command.'})};
    }, 'Repair the terminal command in Settings → General.');
    await check('path', async () => {
        const result = await installation();
        return {status: result.inPath ? 'ok' : 'warning', message: result.inPath ? 'The managed fdo command is on PATH.' : 'PATH does not resolve to a current managed fdo command.',
            ...(result.inPath ? {} : {fix: 'Open a new terminal. Add the installed wrapper directory to PATH, ahead of any other fdo command.'})};
    }, 'Check your PATH and repair the terminal command.');
    await check('profile', () => {
        if (!fs.statSync(profile).isDirectory()) throw new Error(`Not a directory: ${profile}`);
        fs.accessSync(profile, fs.constants.R_OK | fs.constants.W_OK);
        return {status: 'ok', message: `Profile is readable and writable: ${profile}`};
    }, 'Check profile directory ownership and permissions.');
    await check('registry', () => {
        const registry = readCliRegistry(registryFile);
        const ids = new Set();
        for (const plugin of registry.plugins) {
            if (!plugin || typeof plugin.id !== 'string' || !plugin.id || ids.has(plugin.id) || typeof plugin.home !== 'string'
                || (plugin.capabilities !== undefined && !Array.isArray(plugin.capabilities))) throw new Error(`Invalid or duplicate plugin record in ${registryFile}`);
            ids.add(plugin.id);
        }
        const enabled = activatedPlugins(configFile);
        const missing = registry.plugins.filter(plugin => !fs.existsSync(path.join(plugin.home, plugin.entry || ''))).map(plugin => plugin.id);
        const orphaned = enabled.filter(id => !ids.has(id));
        if (missing.length || orphaned.length) return {status: 'warning', message: `Missing plugin paths: ${missing.join(', ') || 'none'}; enabled IDs absent from registry: ${orphaned.join(', ') || 'none'}.`, fix: 'Review Manage Plugins and redeploy missing plugins.'};
        return {status: 'ok', message: `${registry.plugins.length} installed plugin(s); registry and activation configuration are readable.`};
    }, 'Restore a valid plugins.json/config.json backup or review Manage Plugins.');
    await check('credential-store', () => {
        if (!credentialStoreAvailable()) throw new Error('OS credential store is unavailable for protected signing keys.');
        return {status: 'ok', message: 'OS credential store is available (private keys were not decrypted).'};
    }, 'Unlock or configure your OS credential store and retry.');
    await check('signing', () => {
        const cert = listCertificates().find(item => item.label === 'root');
        if (!cert) return {status: 'warning', message: 'Default root signing certificate has not been created.', fix: 'The first sign/deploy with label root creates it automatically; or import an identity in Settings → Certificates.'};
        const parsed = new X509Certificate(cert.cert);
        if (!cert.hasPrivateKey) throw new Error('Default root certificate has no private key.');
        if (new Date(parsed.validFrom) > now || new Date(parsed.validTo) <= now) throw new Error('Default root certificate is outside its validity period.');
        return {status: 'ok', message: `Default root signing certificate expires ${new Date(parsed.validTo).toISOString()}.`};
    }, 'Review the root identity in Settings → Certificates; renew or import a valid signing identity.');
    return {version, profile, healthy: checks.every(item => item.status === 'ok'), checks};
}
