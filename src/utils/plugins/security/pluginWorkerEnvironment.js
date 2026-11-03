import path from 'node:path';

// Construct the worker environment from scratch. Never inherit credentials,
// loader flags, proxies, or the host user's home/configuration directories.
export function buildPluginWorkerEnvironment({
    pluginHome, pluginCodeHome, runtimeEntry, bootstrapEntry, nodeModulesPath,
    grantedCapabilities = [], runtimePolicy, hostEnv = process.env, platform = process.platform,
}) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const home = paths.resolve(pluginHome);
    const temp = paths.join(home, '.tmp');
    const modulePaths = nodeModulesPath.split(paths.delimiter).filter(Boolean).map(entry => paths.resolve(entry));
    const readRoots = [...new Set([
        home, paths.resolve(pluginCodeHome), paths.dirname(paths.resolve(runtimeEntry)),
        paths.dirname(paths.resolve(bootstrapEntry)), ...modulePaths,
    ])];
    const env = {
        HOME: home, USERPROFILE: home,
        TMPDIR: temp, TMP: temp, TEMP: temp,
        XDG_CONFIG_HOME: paths.join(home, '.config'),
        XDG_CACHE_HOME: paths.join(home, '.cache'),
        XDG_DATA_HOME: paths.join(home, '.local', 'share'),
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        PLUGIN_HOME: home,
        PLUGIN_CODE_HOME: paths.resolve(pluginCodeHome),
        FDO_SDK_STORAGE_ROOT: home,
        FDO_SDK_LOG_ROOT: paths.join(home, 'logs'),
        LOG_LEVEL: 'info',
        // Electron utilityProcess always ignores stdin; fd 0 cannot contain
        // the application's terminal input or credentials.
        FDO_PLUGIN_STDIN_IGNORED: '1',
        FDO_PLUGIN_RUNTIME_ENTRY: paths.resolve(runtimeEntry),
        FDO_PLUGIN_CAPABILITIES: grantedCapabilities.join(','),
        FDO_PLUGIN_POLICY_JSON: JSON.stringify(runtimePolicy),
        FDO_PLUGIN_READ_ROOTS: JSON.stringify(readRoots),
        FDO_PLUGIN_NODE_PATH: modulePaths.join(paths.delimiter),
        NODE_PATH: modulePaths.join(paths.delimiter),
    };
    for (const key of ['LANG', 'LC_ALL', 'TZ']) {
        if (typeof hostEnv[key] === 'string' && /^[\w./:@+-]{1,128}$/.test(hostEnv[key])) env[key] = hostEnv[key];
    }
    if (platform === 'win32') {
        const systemRoot = Object.entries(hostEnv).find(([key]) => key.toLowerCase() === 'systemroot')?.[1] || 'C:\\Windows';
        env.SystemRoot = systemRoot;
        env.WINDIR = systemRoot;
        env.PATH = [paths.join(systemRoot, 'System32'), systemRoot].join(';');
        env.APPDATA = paths.join(home, 'AppData', 'Roaming');
        env.LOCALAPPDATA = paths.join(home, 'AppData', 'Local');
    }
    return env;
}
