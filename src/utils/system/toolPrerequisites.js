import fs from 'node:fs';
import path from 'node:path';
import {getAllHostProcessScopePolicies} from '../plugins/security/privilegedProcessScopeRegistry';
import {installGuide, x11InstallGuide} from './toolInstallCatalog';

// Inspect the same executable paths as host authorization. Never execute a
// discovered binary or accept executable paths/commands from the renderer.
export async function inspectToolPrerequisites({platform = process.platform, policies = getAllHostProcessScopePolicies(), access = fs.promises.access, stat = fs.promises.stat} = {}) {
    const tools = new Map();
    for (const policy of Object.values(policies)) {
        for (const candidate of policy.allowedExecutables || []) {
            const windows = path.win32.isAbsolute(candidate) && !candidate.startsWith('/');
            if (!path[windows ? 'win32' : 'posix'].isAbsolute(candidate)) continue;
            const compatible = windows === (platform === 'win32');
            const name = path[windows ? 'win32' : 'posix'].basename(candidate).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
            if (!compatible && !installGuide(name, platform)) continue;
            if (!tools.has(name)) tools.set(name, {id:name, label:installGuide(name, platform)?.label || name, paths:[], capabilities:[], categories:[], installation:installGuide(name, platform)});
            const tool = tools.get(name);
            if (compatible && !tool.paths.includes(candidate)) tool.paths.push(candidate);
            if (!tool.capabilities.includes(`system.process.scope.${policy.scope}`)) tool.capabilities.push(`system.process.scope.${policy.scope}`);
            if (!tool.categories.includes(policy.category)) tool.categories.push(policy.category);
        }
    }
    const results = await Promise.all([...tools.values()].map(async tool => {
        let executable = '', uncertain = false;
        for (const candidate of tool.paths) {
            try {
                if (!(await stat(candidate)).isFile()) continue;
                await access(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                executable = candidate; break;
            } catch (error) {if (!['ENOENT','ENOTDIR'].includes(error?.code)) uncertain = true;}
        }
        return {...tool, executable, status:!tool.paths.length ? 'unsupported' : executable ? 'found' : uncertain ? 'unavailable' : 'missing'};
    }));
    const x11 = x11InstallGuide(platform);
    let xauthFound = false;
    if (platform !== 'win32') {
        try {await access(platform === 'darwin' ? '/opt/X11/bin/xauth' : '/usr/bin/xauth', fs.constants.X_OK); xauthFound = true;} catch { /* Availability is separately authenticated by Local X11 support. */ }
    }
    return {platform, checkedAt:Date.now(), tools:results.sort((a,b) => a.label.localeCompare(b.label)), x11:{...x11, xauthFound, supported:platform !== 'win32'}};
}
