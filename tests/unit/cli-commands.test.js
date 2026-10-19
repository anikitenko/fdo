import {
    CLI_COMMANDS,
    CLI_ONLY_COMMANDS,
    getCleanCliArgs,
    hasCliCommand,
    hasCliOnlyCommand,
} from "../../src/utils/system/cliCommands";

describe("CLI command routing", () => {
    test("registers sdk command as recognized CLI command", () => {
        expect(CLI_COMMANDS).toContain("sdk");
        expect(CLI_ONLY_COMMANDS).toContain("sdk");
        expect(hasCliCommand(["sdk", "migrate", "--target", "."])).toBe(true);
        expect(hasCliOnlyCommand(["sdk", "migrate", "--target", "."])).toBe(true);
    });

    test("keeps sdk subcommand arguments in cleaned argv", () => {
        const cleaned = getCleanCliArgs(["node", "sdk", "migrate", "--target", "./plugin"]);
        expect(cleaned).toEqual(["sdk", "migrate", "--target", "./plugin"]);
    });
});

test('unknown commands are parsed and command-valued operands do not change routing', () => {
    expect(hasCliCommand(['compiel'])).toBe(true);
    expect(hasCliCommand(['--unknown'])).toBe(true);
    expect(hasCliCommand(['fdo-fiddle://example'])).toBe(false);
    expect(hasCliOnlyCommand(['open', '--help'])).toBe(true);
    expect(hasCliOnlyCommand(['open', 'compile'])).toBe(false);
});
test('normalizes Electron entry and compatibility flag without consuming packaged paths', () => {
    expect(getCleanCliArgs(['electron', '.', '--cli', 'compile', 'open'], {defaultApp: true})).toEqual(['compile', 'open']);
    expect(getCleanCliArgs(['fdo', '.', 'compile'], {defaultApp: false})).toEqual(['.', 'compile']);
    expect(getCleanCliArgs(['fdo', '-psn_0_123', '--help'], {defaultApp: false})).toEqual(['--help']);
    expect(getCleanCliArgs(['fdo', 'compile', '--', '--cli'], {defaultApp: false})).toEqual(['compile', '--', '--cli']);
});

test('Electron bootstrap modules are not interpreted as CLI operands', () => {
    expect(getCleanCliArgs(['electron', '-r', '/loader.cjs', '.', 'compile', 'project'], {defaultApp: true})).toEqual(['compile', 'project']);
    expect(getCleanCliArgs(['electron', '-r', '/loader.cjs', '.'], {defaultApp: true})).toEqual([]);
    expect(getCleanCliArgs(['fdo', '--require=/loader.cjs', '--help'], {defaultApp: false})).toEqual(['--help']);
});

test('Chromium switches before the dev app entry are not passed to Commander', () => {
    expect(getCleanCliArgs(['electron', '-r', '/loader.cjs', '--no-sandbox', '.', 'validate', 'project', '--json'], {defaultApp: true}))
        .toEqual(['validate', 'project', '--json']);
    expect(getCleanCliArgs(['electron', '-r', '/bootstrap.cjs', '--disable-gpu', '--user-data-dir=/tmp/fdo', '.', 'deploy', 'plugin'], {defaultApp: true}))
        .toEqual(['deploy', 'plugin']);
});
