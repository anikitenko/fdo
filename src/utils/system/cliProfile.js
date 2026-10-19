import path from 'node:path';

export const cliProfile = {name: 'default', args: null};

// Profile selection is parsed before loading any module that opens persistence.
// Restrict it to root options before the command; never reinterpret operands.
export function resolveCliProfile(args, baseDirectory) {
    const remaining = [];
    let name = 'default', selected = false, index = 0;
    while (index < args.length) {
        const argument = args[index];
        if (argument === '--profile' || argument.startsWith('--profile=')) {
            if (selected) throw new Error('--profile may only be supplied once.');
            selected = true;
            name = argument === '--profile' ? args[++index] : argument.slice('--profile='.length);
            if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name)) throw new Error('Profile names must contain 1–48 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.');
        } else if (argument === '--json') remaining.push(argument);
        else break;
        index++;
    }
    remaining.push(...args.slice(index));
    return {name, args: remaining, directory: name === 'default' ? path.resolve(baseDirectory) : path.join(path.resolve(baseDirectory), 'profiles', name)};
}
