import {scaffoldCliPlugin} from './cliScaffold';
import {PLUGIN_TEMPLATES} from '../plugins/authoring/pluginTemplateCatalog';
import {getCliCompletion} from './cliCompletion';
import {Command} from 'commander';
import path from 'node:path';
import os from 'node:os';
import {createInterface} from 'node:readline/promises';
import {runSdkMigration, getSdkMigrationExitCode} from '../sdk/sdkMigrationCli';
import {requirePluginDirectory} from './cliPluginOperations';

function resolvePath(input) {
    return path.resolve(/^~(?:[\\/]|$)/.test(input) ? path.join(os.homedir(), input.slice(1)) : input);
}

function printMigration(report, output) {
    output.log(`SDK migration (${report.mode})\nTarget: ${report.targetPath}\nScanned files: ${report.scannedFiles}\nFiles to update: ${report.filesToUpdate}\nUpdated files: ${report.updatedFiles}`);
    for (const file of report.files) {
        output.log(`- ${file.relativePath}`);
        for (const hit of file.ruleHits) output.log(`  ${hit.rule}: ${hit.replacements} replacement(s)`);
    }
    if (report.cancelled) output.log('Migration cancelled. No files were modified.');
    else if (report.mode === 'dry-run') output.log('Dry-run only. Use --write in an interactive terminal to apply changes.');
}

// No actions exit the process: one caller owns shutdown and the final status.
export async function runFdoCli(args, dependencies) {
    const {version, compile, sign, deploy, listCertificates, output = console, stdin = process.stdin, stdout = process.stdout} = dependencies;
    const program = new Command().name('fdo').description('FlexDevOps (FDO) Application CLI').version(version).option('--json', 'Output a JSON result for scripting').option('--profile <name>', 'Use a named profile (place before the command)').exitOverride().showHelpAfterError();
    program.configureOutput({writeOut: text => stdout.write(text), writeErr: text => (dependencies.stderr || process.stderr).write(text)});
    program.hook('preAction', () => {
        if (program.opts().profile) throw new Error('--profile must precede the command, for example: fdo --profile development plugins list.');
    });
    let openGui = false, commandName, data, exitCode = 0;
    const isJson = () => !!program.opts().json;
    const report = (command, result, print) => {commandName = command; data = result; if (!isJson()) print();};
    program.command('completion <shell>').description('Print a shell completion script').action(shell => {
        if (isJson()) throw new Error('--json is unavailable for completion scripts.');
        stdout.write(getCliCompletion(shell));
    });
    program.command('open').description('Open FDO application').action(() => {if (isJson()) throw new Error('--json is unavailable for the open command.'); openGui = true;});
    program.command('init <path>').description('Create a plugin workspace from an editor starter template')
        .option('--name <id>', 'Plugin ID (defaults to the normalized directory name)')
        .option('--display-name <title>', 'Plugin display name')
        .option('--template <template>', `Starter: ${PLUGIN_TEMPLATES.map(item => item.value).join(', ')}`, 'blank')
        .action((input, options) => {
            const result = scaffoldCliPlugin(resolvePath(input), {name: options.name, displayName: options.displayName, template: options.template});
            report('init', result, () => {
                output.log(`Created ${result.name} (${result.template}) in ${result.directory}\n${result.files.length} files created.`);
                output.log('Next: run fdo validate <path>, then fdo dev <path> with this workspace directory.');
            });
        });
    program.command('compile <path>').description('Compile a plugin workspace').action(async input => {
        const result = await compile(resolvePath(input));
        report('compile', result, () => output.log(`Compiled plugin: ${result.destination}`));
    });
    program.command('test <path>').description('Run workspace tests using the editor test runner')
        .option('--timeout <seconds>', 'Timeout per test file (1–3600 seconds)', '30').action(async (input, options) => {
            if (!/^\d+$/.test(options.timeout) || Number(options.timeout) < 1 || Number(options.timeout) > 3600) throw new Error('--timeout must be an integer from 1 to 3600 seconds.');
            const result = await dependencies.test(resolvePath(input), Number(options.timeout) * 1000);
            exitCode = result.success && !result.skipped ? 0 : 1;
            report('test', result, () => {output.log(result.output || result.error || 'Plugin tests completed.');});
        });
    const profiles = program.command('profiles').description('Inspect available profiles').action(() => profiles.outputHelp());
    profiles.command('list').description('List profiles, locations and installed plugin counts').action(async () => {
        const result = await dependencies.listProfiles();
        exitCode = result.some(profile => profile.error) ? 1 : 0;
        report('profiles list', result, () => {
            for (const profile of result) output.log(`${profile.current ? '* ' : '  '}${profile.name}: ${profile.directory} (${profile.pluginCount ?? '?'} plugins)${profile.error ? ` — ${profile.error}` : ''}`);
        });
    });
    program.command('dev <path>').description('Watch, rebuild and redeploy a plugin workspace')
        .option('-l, --label <label>', 'Signing certificate label', 'root').action(async (input, options) => {
            if (isJson()) throw new Error('--json is unavailable for the dev watch command.');
            await dependencies.dev(resolvePath(input), options.label);
        });
    program.command('validate <path>').description('Validate a plugin workspace with an in-memory build').action(async input => {
        const result = await dependencies.validate(resolvePath(input));
        report('validate', result, () => {
            output.log(`Valid plugin: ${result.name} ${result.metadata.version}\nSource: ${result.source}\nBuild output: ${result.destination}`);
            output.log(`Declared capabilities: ${result.capabilities === null ? 'not statically inspectable' : result.capabilities.join(', ') || 'none'}`);
            for (const warning of result.warnings) output.log(`Warning: ${warning}`);
        });
    });
    program.command('deploy <path>').description('Compile, sign and install a plugin workspace')
        .option('-l, --label <label>', 'Signing certificate label', 'root')
        .option('--dry-run', 'Validate and preview deployment without changing plugin files, registry or certificates').action(async (input, options) => {
            if (options.dryRun) {
                const result = await dependencies.planDeployment(resolvePath(input), options.label);
                report('deploy', result, () => {
                    output.log(`Deployment preview: ${result.action} ${result.plugin.name} ${result.plugin.metadata.version}\nProfile: ${result.profile}\nRegistry: ${result.registryFile}`);
                    if (result.previousVersion) output.log(`Previous version: ${result.previousVersion}`);
                    output.log(`Signing identity: ${result.signer.label} (${result.signer.status})\nPreserved capability grants: ${result.grants.capabilities.join(', ') || 'none'}`);
                    for (const warning of result.warnings) output.log(`Warning: ${warning}`);
                    output.log('Dry-run only. No plugin files, registry entries or certificates were changed.');
                });
                return;
            }
            const result = await deploy(resolvePath(input), options.label);
            report('deploy', result, () => output.log(`Deployed plugin: ${result.name}`));
        });
    const signing = program.command('sign').description('Manage plugin signing').action(() => {signing.outputHelp();});
    signing.command('list').description('List available signing certificates').action(() => {
        const certificates = listCertificates();
        report('sign list', certificates.map(({id, label, hasPrivateKey, expiresAt}) => ({id, label, hasPrivateKey, expiresAt})), () => {
            if (!certificates.length) output.log('No signing certificates found. Create or import one in FDO Settings → Certificates.');
            for (const cert of certificates) output.log(`${cert.label} (${cert.id})${cert.hasPrivateKey ? '' : ' [verification only]'}`);
        });
    });
    signing.command('plugin <path>').description('Sign a plugin workspace')
        .option('-l, --label <label>', 'Signing certificate label', 'root').action(async (input, options) => {
            const directory = resolvePath(input); requirePluginDirectory(directory);
            await sign(directory, options.label);
            report('sign plugin', {directory, label: options.label}, () => output.log(`Signed plugin: ${directory}`));
        });
    program.command('doctor').description('Check CLI installation, profile, registry and signing readiness').action(async () => {
        const result = await dependencies.doctor();
        exitCode = result.healthy ? 0 : 1;
        report('doctor', result, () => {
            for (const check of result.checks) output.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}${check.fix ? `\n  Fix: ${check.fix}` : ''}`);
        });
    });
    const plugins = program.command('plugins').description('Inspect installed plugins').action(() => plugins.outputHelp());
    const printPlugin = plugin => {
        output.log(`${plugin.id} ${plugin.version || '(unknown version)'} [${plugin.enabled ? 'enabled' : 'disabled'}] — signature: ${plugin.signature.status}`);
        output.log(`  Granted capabilities: ${plugin.capabilities.join(', ') || 'none'}`);
    };
    plugins.command('list').description('List installed plugins and verify their signatures').action(async () => {
        const result = await dependencies.inspectPlugins();
        report('plugins list', result, () => {if (!result.length) output.log('No plugins installed.'); result.forEach(printPlugin);});
    });
    plugins.command('logs <id>').description('Read or follow plugin runtime logs')
        .option('-f, --follow', 'Stream appended logs until Ctrl+C')
        .option('-n, --lines <count>', 'Initial lines per file (0–10000; at most 64 KiB per file)', '100')
        .action(async (id, options) => {
            if (!/^\d+$/.test(options.lines) || Number(options.lines) > 10000) throw new Error('--lines must be an integer from 0 to 10000.');
            if (options.follow) {
                if (isJson()) throw new Error('--json is unavailable with logs --follow.');
                await dependencies.followLogs(id, Number(options.lines));return;
            }
            const result = await dependencies.logs(id, Number(options.lines));
            report('plugins logs', result, () => {
                if (!result.logs.length) output.log('No plugin runtime logs found.');
                for (const log of result.logs) output.log(`[${log.file}]\n${log.text}`);
            });
        });
    plugins.command('verify [id]').description('Verify installed plugin signatures; fail if any is invalid')
        .action(async id => {
            const inspected = await dependencies.inspectPlugins(id);
            const result = {valid: inspected.length > 0 && inspected.every(plugin => plugin.signature.status === 'valid'), checked: inspected.length,
                plugins: inspected.map(({id, version, signature}) => ({id, version, signature}))};
            exitCode = result.valid ? 0 : 1;
            report('plugins verify', result, () => {
                if (!result.checked) output.log('No installed plugins to verify.');
                for (const plugin of result.plugins) output.log(`${plugin.id}: ${plugin.signature.status}${plugin.signature.error ? ` — ${plugin.signature.error}` : ''}`);
                output.log(`Verified ${result.checked} plugin(s): ${result.valid ? 'all signatures valid' : 'verification failed'}.`);
            });
        });
    plugins.command('info <id>').description('Inspect a plugin, its grants and signature').action(async id => {
        const [plugin] = await dependencies.inspectPlugins(id);
        report('plugins info', plugin, () => {
            printPlugin(plugin); output.log(`  Home: ${plugin.home}\n  Entry: ${plugin.entry || '(unknown)'}\n  GitOps: ${plugin.gitops ? 'yes' : 'no'}`);
            output.log(`  Process scopes: ${JSON.stringify(plugin.customProcessScopes)}\n  Filesystem scopes: ${JSON.stringify(plugin.customFilesystemScopes)}`);
            if (plugin.signature.error) output.log(`  Signature error: ${plugin.signature.error}`);
        });
    });
    const sdk = program.command('sdk').description('SDK development commands').action(() => {sdk.outputHelp();});
    sdk.command('migrate').description('Migrate plugin sources (dry-run by default)')
        .requiredOption('--target <path>', 'Plugin file or directory').option('--write', 'Apply changes after interactive confirmation')
        .action(async options => {
            if (options.write && (!stdin.isTTY || !stdout.isTTY)) throw Object.assign(new Error('--write requires an interactive terminal for confirmation.'), {exitCode: 2});
            try {
                const report = await (dependencies.migrate || runSdkMigration)({target: resolvePath(options.target), write: !!options.write,
                    confirmWrite: async ({targetPath, filesToUpdate}) => {
                        const readline = createInterface({input: stdin, output: isJson() ? (dependencies.stderr || process.stderr) : stdout});
                        try {return /^(?:y|yes)$/i.test((await readline.question(`Apply changes to ${filesToUpdate} file(s) in ${targetPath}? [y/N] `)).trim());}
                        finally {readline.close();}
                    }});
                commandName = 'sdk migrate'; data = report; if (!isJson()) printMigration(report, output);
            } catch (error) {error.exitCode = getSdkMigrationExitCode(error); throw error;}
        });
    try {
        await program.parseAsync(args.length ? args : ['--help'], {from: 'user'});
        if (isJson() && commandName) stdout.write(JSON.stringify({ok: exitCode === 0, command: commandName, data}) + '\n');
        return {exitCode, openGui};
    } catch (error) {
        if (isJson() && error.exitCode !== 0) stdout.write(JSON.stringify({ok: false, error: {message: error.message, code: error.code || 'CLI_ERROR'}}) + '\n');
        if (!error.code?.startsWith('commander.')) output.error(`Error: ${error.message || String(error)}`);
        return {exitCode: Number.isInteger(error.exitCode) ? error.exitCode : 1, openGui: false};
    }
}

export async function flushCliOutput(streams = [process.stdout, process.stderr]) {
    await Promise.all(streams.map(stream => !stream.destroyed && stream.writable
        ? new Promise(resolve => {try {stream.write('', resolve);} catch {resolve();}}) : Promise.resolve()));
}
