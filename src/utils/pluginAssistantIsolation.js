import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const quote = value => JSON.stringify(value);

// CLI agents must not inherit FDO's repository, settings, environment, or user tool configuration.
// Unsupported platforms fail closed; API assistants do not launch local agent tools.
export async function createPluginAssistantIsolation(invocation, provider, hostPaths = []) {
    if (process.platform !== "darwin") {
        throw new Error("Plugin-only CLI isolation is not available on this platform. Use an API coding assistant.");
    }
    await fs.access("/usr/bin/sandbox-exec");
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fdo-plugin-assistant-")));
    try {
        const home = path.join(root, "home");
        const workspace = path.join(root, "workspace");
        await fs.mkdir(home);
        await fs.mkdir(workspace);
        const config = path.join(home, provider === "codex-cli" ? ".codex" : ".gemini");
        await fs.mkdir(config);
        const originalConfig = provider === "codex-cli"
            ? process.env.CODEX_HOME || path.join(os.homedir(), ".codex")
            : path.join(os.homedir(), ".gemini");
        const credentialFiles = provider === "codex-cli" ? ["auth.json"] : ["oauth_creds.json", "google_accounts.json"];
        for (const file of credentialFiles) {
            try {
                await fs.copyFile(path.join(originalConfig, file), path.join(config, file));
                await fs.chmod(path.join(config, file), 0o600);
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
        }
        if (provider === "gemini-cli") {
            await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({security: {auth: {selectedType: "oauth-personal"}}}));
        }
        if (provider !== "codex-cli" || !invocation.bundled || invocation.args?.length) {
            throw new Error("Plugin-only isolation currently requires the bundled native Codex runtime. Use bundled Codex or an API coding assistant.");
        }
        const executable = path.join(root, "codex");
        await fs.copyFile(invocation.command, executable);
        await fs.chmod(executable, 0o700);
        const protectedPaths = [...new Set(await Promise.all(
            [os.homedir(), process.cwd(), ...hostPaths].filter(Boolean).map(async value => {
                try { return await fs.realpath(value); } catch { return path.resolve(value); }
            })
        ))];
        const profile = `(version 1)
(allow default)
${protectedPaths.map(dir => `(deny file-read* file-write* (subpath ${quote(dir)}))`).join("\n")}
(deny network* (remote ip "localhost:*"))
`;
        const profilePath = path.join(root, "isolation.sb");
        await fs.writeFile(profilePath, profile, {mode: 0o600});
        const env = {
            HOME: home, CODEX_HOME: config, GEMINI_CLI_HOME: home,
            XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
            TMPDIR: root, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8",
            ...(invocation.env?.ELECTRON_RUN_AS_NODE ? {ELECTRON_RUN_AS_NODE: invocation.env.ELECTRON_RUN_AS_NODE} : {}),
        };
        return {
            command: "/usr/bin/sandbox-exec",
            args: ["-f", profilePath, executable],
            options: {cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"]},
            cleanup: () => fs.rm(root, {recursive: true, force: true}),
        };
    } catch (error) {
        await fs.rm(root, {recursive: true, force: true});
        throw error;
    }
}
