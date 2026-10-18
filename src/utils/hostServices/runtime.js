import {createHostKeyScanner} from './hostKeyScan.cjs';
import {app, safeStorage} from 'electron';
import path from 'node:path';
import {Client} from 'ssh2';
import PluginORM from '../persistence/PluginORM';
import {openVault} from './database.cjs';
import {createHostService} from './service.cjs';
import {runGitTransport} from './gitTransport.cjs';
import {failure} from './contracts.cjs';
import {createProtection} from './protection.cjs';

let runtime;
const hostKeyScanner = createHostKeyScanner({Client, audit: (...args) => runtime?.vault.audit(...args)});
export function scanSSHHostKey(owner, endpoint, signal) {getHostServices(); return hostKeyScanner.scan(owner, endpoint, signal);}
const root = () => process.env.FDO_E2E_USER_DATA_DIR || app.getPath('userData');
const registry = () => new PluginORM(path.join(root(), 'plugins.json'));
export function getHostServices() {
    if (runtime) return runtime;
    if (!app.isReady()) throw failure('UNAVAILABLE');
    const protection = createProtection(safeStorage);
    const {check} = protection;
    const vault = openVault(path.join(root(), 'host-services', 'vault.sqlite'), protection);
    const service = createHostService({vault, Client,
        executeGit: options => runGitTransport({Client, ...options, helperPath: path.join(__dirname, 'gitSshHelper.cjs').replace('app.asar/', 'app.asar.unpacked/')}),
        getGrants: id => registry().getPlugin(id)?.capabilities || [],
        isInstalled: id => registry().isInstalled(id),
        audit: (...args) => vault.audit(...args),
    });
    runtime = {service, vault, check};
    return runtime;
}
export function invalidateHostServices(id) {hostKeyScanner.cancel(id); runtime?.service.cancel(id);}
export function createHostServiceEndpoint(id) {
    let endpoint, closed = false;
    return {
        request(value, requestId) {
            if (closed) return Promise.reject(failure('UNAVAILABLE'));
            try {endpoint ||= getHostServices().service.bind(id); return endpoint.request(value, requestId);}
            catch {return Promise.reject(failure('UNAVAILABLE'));}
        },
        operation(operation,payload,requestId) {
            if(closed)return Promise.reject(failure('UNAVAILABLE'));
            try {endpoint ||= getHostServices().service.bind(id);return endpoint.operation(operation,payload,requestId);}
            catch(error){return Promise.reject(failure(error?.code));}
        },
        close() {closed = true; runtime?.service.cancel(id); endpoint?.close();},
    };
}
export function removeHostServices(id) {hostKeyScanner.cancel(id); getHostServices().service.uninstall(id);}
export function closeHostServices() {hostKeyScanner.close(); const closing = runtime?.service.close(); runtime = undefined; return closing || Promise.resolve();}

export function runGitWithProfiles(id, plan, requestId) {
    if (['version', 'status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'restore', 'reset', 'merge', 'rebase', 'tag', 'checkout', 'switch'].includes(plan.args[0])) return Promise.resolve(null);
    return getHostServices().service.runGit(id, plan, requestId);
}
