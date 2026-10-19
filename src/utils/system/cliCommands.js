import fs from 'node:fs';

export const CLI_COMMANDS = ['help', '--help', '-h', '--version', '-V', 'open', 'test', 'profiles', 'init', 'compile', 'dev', 'validate', 'deploy', 'sign', 'sdk', 'doctor', 'plugins', 'completion'];
export const CLI_ONLY_COMMANDS = CLI_COMMANDS.filter(command => command !== 'open');
export const GUI_COMMANDS = ['open'];

// Unknown commands must reach Commander too, so typos fail instead of opening UI.
export function hasCliCommand(args) {
    return args.length > 0 && !/^fdo-fiddle:\/\//i.test(args[0]);
}
export function hasGuiCommand(args) {
    return args[0] === 'open' && !args.slice(1).some(arg => ['--help', '-h'].includes(arg));
}
export function hasCliOnlyCommand(args) {
    return hasCliCommand(args) && !hasGuiCommand(args);
}

export function getCleanCliArgs(argv, {defaultApp = process.defaultApp} = {}) {
    if (!Array.isArray(argv) || argv.length <= 1) return [];
    // Electron supplies an app entry only in development. Never consume an
    // existing user-supplied path as an app entry in a packaged invocation.
    let offset = 1;
    // Electron retains Node bootstrap flags in argv (including Playwright's
    // loader). They precede the application entry, not the user's command.
    const chromiumBooleanFlags = new Set([
        '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer',
        '--disable-gpu-shader-disk-cache', '--disable-http-cache', '--use-mock-keychain',
    ]);
    const chromiumFlagsWithValue = new Set(['--user-data-dir', '--disk-cache-dir', '--gpu-disk-cache-dir', '--media-cache-dir', '--password-store']);
    while (offset < argv.length) {
        const argument = argv[offset];
        if (['-r', '--require'].includes(argument) && offset + 1 < argv.length) offset += 2;
        else if (/^--(?:require|inspect(?:-brk)?|remote-debugging-port)=/.test(argument)) offset++;
        else if (/^--(?:user-data-dir|disk-cache-dir|gpu-disk-cache-dir|media-cache-dir|password-store)=/.test(argument)) offset++;
        else if (chromiumFlagsWithValue.has(argument) && offset + 1 < argv.length) offset += 2;
        else if (chromiumBooleanFlags.has(argument)) offset++;
        else break;
    }
    if (defaultApp === true && offset < argv.length) offset++;
    if (defaultApp === undefined && offset < argv.length && !CLI_COMMANDS.includes(argv[offset]) && !argv[offset].startsWith('-')) {
        try {if (fs.existsSync(argv[offset])) offset++;} catch { /* Preserve the argument for validation. */ }
    }
    const args = argv.slice(offset).filter(arg => !/^-psn_\d+_\d+$/.test(arg));
    // Compatibility switch is consumed by the host, never passed to Commander.
    if (args[0] === '--cli') args.shift();
    return args;
}
