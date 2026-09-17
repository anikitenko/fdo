import {
    CLI_COMMANDS,
    CLI_ONLY_COMMANDS,
    getCleanCliArgs,
    hasCliCommand,
    hasCliOnlyCommand,
} from "../../src/utils/cliCommands";

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
