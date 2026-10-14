# Codex hooks in FDO

Settings → AI Extensions → Codex → Hooks configures commands for native lifecycle events. Add a hook, expand Hook settings, select saved Codex coding assistants, enable it, and save assignments. New hooks are disabled and unassigned. Removing a hook does not delete its script.

Choose SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, PostCompact, Stop, SessionEnd, or Interrupt. Tool events support a literal name pattern with `*` wildcards, such as `mcp__*`. Shell, file-editing, and subagent tools remain disabled in this integration, so their events will not fire. See the [official hook event and output contracts](https://learn.chatgpt.com/docs/hooks).

Commands run as separately configured trusted processes with your user permissions. Use an installed executable such as `node` or `python3`, and put the script path in an argument row. No shell interpolation is applied to your command arguments. Working directory defaults to your home directory; configure an absolute path when needed. Only basic OS variables and your configured environment values are forwarded.

Hooks receive one event JSON object on stdin. Scripts should return concise native hook output on stdout. JSON output can supply additional context or block supported operations; exit code 2 and a stderr reason are translated into the native blocking response. PostToolUse cannot undo completed actions, and Stop can request continuation rather than reject a response. Command failures and timeouts return errors to Codex; they are not an enforcement guarantee. Hook stdout may become model context, so avoid returning secrets.

FDO runs the command through an authenticated temporary loopback bridge. Codex's shell stays disabled and its existing macOS filesystem restrictions stay active. The bridge authenticates each request, accepts only selected hook IDs and their configured events, and closes with the coding request. POSIX uses `/usr/bin/curl`; Windows uses Windows PowerShell. Hook scripts and their runtimes must be installed separately. Windows/Linux execution needs manual validation on those platforms.

Timeouts are 1–60 seconds, or 1–3 seconds for Interrupt. Output is limited to 64 KiB. Cancellation closes the bridge and stops active commands. Forced process termination can skip native SessionEnd/Interrupt events, so do not depend on those hooks for mandatory cleanup.

FDO starts CLI sessions for generation steps. A session-start or prompt hook can therefore run multiple times while creating one plugin. Hooks observe temporary proposal workspaces and native event data, not the final applied plugin workspace. File-generation repairs are additional generation steps and can rerun hooks. Transport replay is disabled when hooks are selected; explicit retries may repeat external actions. Checkpoint recovery rejects changes to selected hooks or assignments.

The runtime stages only hooks explicitly enabled and assigned in FDO, then uses [`--dangerously-bypass-hook-trust`](https://learn.chatgpt.com/docs/cli/reference) for that generated configuration. FDO does not copy your global Codex hooks. This execution model requires trusted user configuration; hook execution is not available to arbitrary model-generated commands.

## Testing

Test hook executes its configured command using a synthetic event even while the hook is disabled. It shows exit code, duration, and an optional output preview. Configured environment values are redacted from the preview. This verifies command launch, not native lifecycle dispatch or all event-specific output behavior. A test can still have the command's real side effects.

A self-contained Node script for UserPromptSubmit:

```js
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event.hook_event_name,
      additionalContext: 'Prefer small focused modules and test observable behavior.'
    }
  }));
});
```

Save it locally, configure command `node` with its absolute script path as Argument 1, select UserPromptSubmit, and test. Then assign and enable it to inspect native dispatch in AI Progress.

Validation includes settings schema, assignment filtering, secret omission, command timeout/cancellation and output bounds, UI submissions, and CLI-generation regression checks. `node scripts/check-codex-hooks.cjs` runs generated fixture scripts through the actual bundled Codex runtime against a mocked local inference endpoint without account credentials. It verifies SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, and SessionEnd; additional context reaches inference, and a blocked prompt never reaches inference. The probe allows its temporary inference endpoint through the macOS profile while retaining host filesystem restrictions and using the production hook bridge.

Compaction and Interrupt event dispatch still need validation in real sessions. Windows/Linux native hook execution needs testing on those platforms.
