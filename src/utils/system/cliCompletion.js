import {PLUGIN_TEMPLATES} from '../plugins/authoring/pluginTemplateCatalog';
const templates = PLUGIN_TEMPLATES.map(item => item.value).join(' ');
const commands = 'open test profiles init compile validate deploy dev sign sdk doctor plugins completion';

const bash = `# FDO Bash completion (compatible with Bash 3.2+)
_fdo() {
    local cur prev command='' action='' word i skip=0 item
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    for ((i=1; i<COMP_CWORD; i++)); do
        word="\${COMP_WORDS[i]}"
        if ((skip)); then skip=0; continue; fi
        if [[ -z "$command" ]]; then
            case "$word" in
                --profile) skip=1 ;;
                --profile=*|--json|--cli) ;;
                -*) ;;
                *) command="$word" ;;
            esac
        elif [[ -z "$action" && "$word" != -* ]]; then action="$word"; fi
    done
    if [[ "$prev" == --template ]]; then COMPREPLY=( $(compgen -W '${templates}' -- "$cur") ); return; fi
    [[ "$prev" == --profile || "$prev" == --label || "$prev" == -l || "$prev" == --name || "$prev" == --display-name || "$prev" == --timeout || "$prev" == --lines || "$prev" == -n ]] && return
    if [[ -z "$command" ]]; then
        COMPREPLY=( $(compgen -W '${commands} --help --version --json --profile' -- "$cur") ); return
    fi
    local choices=''
    case "$command" in
        sign) [[ -z "$action" ]] && choices='list plugin' ;;
        plugins) [[ -z "$action" ]] && choices='list info verify logs' ;;
        profiles) [[ -z "$action" ]] && choices='list' ;;
        sdk) [[ -z "$action" ]] && choices='migrate' ;;
        completion) choices='bash zsh fish powershell' ;;
    esac
    if [[ "$cur" == -* ]]; then
        choices='--help --json'
        case "$command" in test) choices+=' --timeout' ;; plugins) [[ "$action" == logs ]] && choices+=' --lines --follow' ;; init) choices+=' --name --display-name --template' ;; deploy) choices+=' --label --dry-run' ;; dev) choices='--help --label' ;; sign) [[ "$action" == plugin ]] && choices+=' --label' ;; sdk) choices+=' --target --write' ;; open) choices='--help' ;; esac
    fi
    if [[ -n "$choices" ]]; then COMPREPLY=( $(compgen -W "$choices" -- "$cur") ); return; fi
    case "$command:$action" in
        test:*|init:*|compile:*|validate:*|deploy:*|dev:*|sign:plugin|sdk:migrate)
            while IFS= read -r item; do COMPREPLY+=("$item"); done < <(compgen -f -- "$cur") ;;
    esac
}
complete -o filenames -F _fdo fdo
`;

const zsh = `#compdef fdo
# Save as _fdo in a directory on fpath; initialize completion with compinit.
_fdo() {
    local context state state_descr line
    typeset -A opt_args
    _arguments -C \\
        '--profile[Use a named profile before the command]:profile:' \\
        '--json[Output JSON]' '--help[Show help]' '--version[Show version]' \\
        '1:command:(${commands})' '*::arguments:->args'
    case "$state" in
        args)
            case "$line[1]" in
                sign) _arguments '1:action:(list plugin)' '--label[Signing identity]:label:' '--json[Output JSON]' '--help[Show help]' '*:workspace:_files -/' ;;
                plugins) _arguments '1:action:(list info verify logs)' '--json[Output JSON]' '--help[Show help]' '2:plugin ID:' '--lines[Initial log lines]:count:' '--follow[Follow log appends]' ;;
                sdk) _arguments '1:action:(migrate)' '--target[Migration target]:target:_files' '--write[Apply migration]' '--json[Output JSON]' '--help[Show help]' ;;
                completion) _arguments '1:shell:(bash zsh fish powershell)' '--help[Show help]' ;;
                deploy) _arguments '--label[Signing identity]:label:' '--dry-run[Preview deployment]' '--json[Output JSON]' '--help[Show help]' '1:workspace:_files -/' ;;
                dev) _arguments '--label[Signing identity]:label:' '--help[Show help]' '1:workspace:_files -/' ;;
                profiles) _arguments '1:action:(list)' '--json[Output JSON]' '--help[Show help]' ;;
                test) _arguments '--timeout[Test timeout in seconds]:seconds:' '--json[Output JSON]' '--help[Show help]' '1:workspace:_files -/' ;;
                init) _arguments '--name[Plugin ID]:name:' '--display-name[Display name]:title:' '--template[Starter template]:template:(${templates})' '--json[Output JSON]' '--help[Show help]' '1:workspace:_files -/' ;;
                compile|validate) _arguments '--json[Output JSON]' '--help[Show help]' '1:workspace:_files -/' ;;
                doctor) _arguments '--json[Output JSON]' '--help[Show help]' ;;
                open) _arguments '--help[Show help]' ;;
            esac ;;
    esac
}
if [[ "$funcstack[1]" == "_fdo" ]]; then
    _fdo "$@"
else
    compdef _fdo fdo
fi
`;

const fish = `# Save under ~/.config/fish/completions/fdo.fish
function __fdo_command
    set -l tokens (commandline -opc)
    set -l skip 0
    for token in $tokens[2..-1]
        if test $skip -eq 1
            set skip 0
            continue
        end
        switch $token
            case --profile
                set skip 1
            case '--profile=*' --json --cli
            case '-*'
            case '*'
                echo $token
                return
        end
    end
end
function __fdo_action
    set -l tokens (commandline -opc)
    set -l command_seen 0
    set -l skip 0
    for token in $tokens[2..-1]
        if test $skip -eq 1
            set skip 0
            continue
        end
        if test $command_seen -eq 0
            switch $token
                case --profile
                    set skip 1
                case '--profile=*' --json --cli
                case '-*'
                case '*'
                    set command_seen 1
            end
        else if not string match -q -- '-*' $token
            echo $token
            return
        end
    end
end
complete -c fdo -n 'test -z (__fdo_command)' -f -a '${commands}'
complete -c fdo -n 'test -z (__fdo_command)' -l profile -r -d 'Named profile (before command)'
complete -c fdo -l help -d 'Show help'
complete -c fdo -n 'test -z (__fdo_command)' -l version -d 'Show version'
complete -c fdo -n 'not contains -- (__fdo_command) open dev completion' -l json -d 'Output JSON'
complete -c fdo -n 'contains -- (__fdo_command) deploy dev sign' -s l -l label -r -d 'Signing identity'
complete -c fdo -n 'contains -- profiles (__fdo_command); and test -z (__fdo_action)' -f -a list
complete -c fdo -n 'contains -- test (__fdo_command)' -l timeout -r -d 'Timeout in seconds'
complete -c fdo -n 'contains -- plugins (__fdo_command); and contains -- logs (__fdo_action)' -l follow -s f -d 'Follow log appends'
complete -c fdo -n 'contains -- plugins (__fdo_command); and contains -- logs (__fdo_action)' -l lines -s n -r -d 'Initial lines per file'
complete -c fdo -n 'contains -- init (__fdo_command)' -l name -r -d 'Plugin ID'
complete -c fdo -n 'contains -- init (__fdo_command)' -l display-name -r -d 'Display name'
complete -c fdo -n 'contains -- init (__fdo_command)' -l template -r -f -a '${templates}' -d 'Starter template'
complete -c fdo -n 'contains -- deploy (__fdo_command)' -l dry-run -d 'Preview deployment'
complete -c fdo -n 'contains -- sign (__fdo_command); and test -z (__fdo_action)' -f -a 'list plugin'
complete -c fdo -n 'contains -- plugins (__fdo_command); and test -z (__fdo_action)' -f -a 'list info verify logs'
complete -c fdo -n 'contains -- sdk (__fdo_command); and test -z (__fdo_action)' -f -a migrate
complete -c fdo -n 'contains -- sdk (__fdo_command)' -l target -r -d 'Migration target'
complete -c fdo -n 'contains -- sdk (__fdo_command)' -l write -d 'Apply migration'
complete -c fdo -n 'contains -- completion (__fdo_command)' -f -a 'bash zsh fish powershell'
`;

const powershell = `#requires -Version 7.0
# Dot-source this file from your PowerShell profile.
Register-ArgumentCompleter -Native -CommandName fdo -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.EndOffset -le ($cursorPosition - $wordToComplete.Length) } | ForEach-Object { $_.Extent.Text.Trim([char[]]@([char]39, [char]34)) })
    $command = ''; $action = ''; $skip = $false
    foreach ($token in $tokens) {
        if ($skip) { $skip = $false; continue }
        if (-not $command) {
            if ($token -eq '--profile') { $skip = $true; continue }
            if ($token -like '-*') { continue }
            $command = $token
        } elseif (-not $action -and $token -notlike '-*') { $action = $token }
    }
    if ($tokens.Count -and $tokens[-1] -in @('--profile','--label','-l','--name','--display-name','--timeout','--lines','-n')) { return }
    $choices = @()
    if ($tokens.Count -and $tokens[-1] -eq '--template') { $choices = '${templates}' -split ' ' }
    elseif (-not $command) { $choices = '${commands} --help --version --json --profile' -split ' ' }
    elseif ($wordToComplete -like '-*') {
        $choices = @('--help','--json')
        switch ($command) {
            test { $choices += '--timeout' }
            plugins { if ($action -eq 'logs') { $choices += @('--follow','--lines') } }
            init { $choices += @('--name','--display-name','--template') }
            deploy { $choices += @('--label','--dry-run') }
            dev { $choices = @('--help','--label') }
            sign { if ($action -eq 'plugin') { $choices += '--label' } }
            sdk { $choices += @('--target','--write') }
            open { $choices = @('--help') }
        }
    } else {
        switch ($command) {
            profiles { if (-not $action) { $choices = @('list') } }
            sign { if (-not $action) { $choices = @('list','plugin') } }
            plugins { if (-not $action) { $choices = @('list','info','verify','logs') } }
            sdk { if (-not $action) { $choices = @('migrate') } }
            completion { $choices = @('bash','zsh','fish','powershell') }
        }
    }
    $choices | Where-Object { $_.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;

export function getCliCompletion(shell) {
    const scripts = {bash, zsh, fish, powershell};
    if (!Object.hasOwn(scripts, shell)) throw new Error('Supported shells: bash, zsh, fish, powershell.');
    return scripts[shell];
}
