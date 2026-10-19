/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {getCliCompletion} from '../../src/utils/system/cliCompletion';
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-completion-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
test('unknown shells are rejected and all supported scripts are printable', () => {
    expect(() => getCliCompletion('__proto__')).toThrow('Supported shells');
    for (const shell of ['bash', 'zsh', 'fish', 'powershell']) expect(getCliCompletion(shell)).toContain('fdo');
});
(process.platform === 'win32' ? test.skip : test)('Bash completion handles commands, nested commands, profile prefixes and paths with spaces', () => {
    const script = path.join(root, 'completion.bash');fs.writeFileSync(script, getCliCompletion('bash'));
    fs.mkdirSync(path.join(root, 'plugin with spaces'));
    const run = words => {
        const args = words.map(word => "'" + word.replace(/'/g, "'\\''") + "'").join(' ');
        const result = spawnSync('bash', ['--noprofile', '--norc', '-c', `source "$1"; COMP_WORDS=(${args}); COMP_CWORD=$((${'${#COMP_WORDS[@]}'}-1)); _fdo; printf '%s\\n' "${'${COMPREPLY[@]}'}"`, 'bash', script], {cwd: root, encoding: 'utf8'});
        expect(result.status).toBe(0);return result.stdout.trim().split('\n');
    };
    expect(run(['fdo', 'de'])).toEqual(['deploy', 'dev']);
    expect(run(['fdo', '--profile', 'dev', 'plugins', 'i'])).toEqual(['info']);
    expect(run(['fdo', 'plugins', 'v'])).toEqual(['verify']);
    expect(run(['fdo', 'init', '--template', 'uti'])).toEqual(['utility']);
    expect(run(['fdo', 'deploy', '--d'])).toEqual(['--dry-run']);
    expect(run(['fdo', 'completion', 'po'])).toEqual(['powershell']);
    expect(run(['fdo', 'compile', 'plugin'])).toEqual(['plugin with spaces']);
});
(process.platform === 'darwin' ? test : test.skip)('Zsh completion parses without syntax errors', () => {
    const script = path.join(root, '_fdo');fs.writeFileSync(script, getCliCompletion('zsh'));
    const result = spawnSync('zsh', ['-n', script], {encoding: 'utf8'});
    expect(result.stderr).toBe('');expect(result.status).toBe(0);
});
(process.platform === 'win32' ? test : test.skip)('PowerShell completion parses and suggests nested commands after a profile prefix', () => {
    const available = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {encoding: 'utf8'});
    if (available.error?.code === 'ENOENT') return; // Optional shell; Windows PowerShell 5 is not supported.
    expect(available.status).toBe(0);
    const script = path.join(root, 'completion.ps1');fs.writeFileSync(script, getCliCompletion('powershell'));
    const source = `$ErrorActionPreference = 'Stop'
function Register-ArgumentCompleter { param([switch]$Native, $CommandName, $ScriptBlock) $script:completer = $ScriptBlock }
. $env:FDO_COMPLETION_SCRIPT
$line = 'fdo --profile dev plugins i'
$ast = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$null, [ref]$null)
@(& $script:completer 'i' $ast.EndBlock.Statements[0].PipelineElements[0] $line.Length) | ForEach-Object { $_.CompletionText }`;
    const result = spawnSync('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {encoding: 'utf8', env: {...process.env, FDO_COMPLETION_SCRIPT: script}});
    expect(result.stderr).toBe('');expect(result.status).toBe(0);expect(result.stdout.trim()).toBe('info');
});
