# Host secrets and SSH, protocol v1

FDO implements the SDK 1.8 backend facade using an authenticated utility-worker channel, an OS-protected SQLite vault, and the bundled JavaScript [`ssh2`](https://github.com/mscdex/ssh2) client. SDK lifecycle hooks remain synchronous; plugins register asynchronous backend handlers in `init()`.

## SDK 1.8.2 Remote Commands integration

The isolated worker installs the optional `watchSSHStatus` and
`startSSHExecution` adapters before plugin initialization. SDK consumers use
`this.ssh.watchStatus(profileId)` and `this.ssh.start(options)`. Existing
`this.ssh.exec(options)` remains buffered; adding adapters does not change an
existing plugin's UI or automatically switch its commands to streaming.

Monitoring requires independent `ssh.use`, `ssh.status.watch`, `secrets.use`
and `secrets.consume` grants and a caller-owned command-authorized profile.
`createSSHCapabilityBundle({monitorStatus:true})` declares monitoring intent;
it never grants permissions. Git-only profiles cannot be monitored. Subscribers
share an authorized monitor within one plugin/profile namespace. The initial
observation is unknown; subsequent observations authenticate a pinned SSH
connection without opening a shell. Probes repeat 5 seconds after each bounded
handshake, and stop when the last subscription ends. Connections configure SSH
keepalives. The handshake ceiling is 10 seconds; observations expire after
20 seconds. Show `checkedAt` and freshness, discard future/skewed or expired
observations, and mark feed loss/end unknown. Reachability at observation time
does not guarantee VM or service availability. Command outcomes remain separate.

Streaming uses host-allocated, worker-scoped execution handles over the private
request bridge. Async iterables/promises never cross IPC or enter the iframe.
Consume `execution.events` and `execution.result` concurrently; render bounded
text batches and do not append buffered streams a second time. The shared capture
prefix defaults to 1 MiB and has a host ceiling of 4 MiB across stdout/stderr.
Incremental decoding preserves split UTF-8 and also bounds encoded replacement
characters. Events have contiguous sequence numbers in host observation order,
which cannot prove remote interleaving order. An absent/slow consumer cannot
block deadlines or create unlimited buffering: the queue caps at 2048 events and
ends capture with `truncated:true` if full. Excess remote output is drained.
Returning the output iterator stops delivery, while bounded buffered capture
continues. The command ceiling is 120 seconds after its separate handshake.

`execution.cancel()` is idempotent. An active cancellation rejects the result
with `CANCELLED`; a completed result is preserved. Timeout rejects with `TIMEOUT`.
Both request TERM and close the channel, but cancellation reports
`remoteProcessStopped:null`: neither a signal request nor socket closure proves
the intended remote workload stopped. Never automatically retry, including after
a lost start acknowledgement. View closure requires an explicit plugin backend
cancellation request; worker teardown independently closes all resources.
Profile/credential changes, deletion and grant revocation invalidate active work.
The host limits active executions to 4 per plugin and 32 globally, monitors to
8 per plugin and 32 globally, and handles to 64 per worker. Terminal execution
handles expire after two minutes; consume results promptly. IDs never grant
cross-worker or cross-plugin access. Bodies, commands and output are not audited.

For persistent nonsecret JSON, FDO supplies a stable writable root before init.
Require both `storage` and `storage.json`, call `store.set(...)`, then await the
public `store.flush()` before acknowledging a save. SDK 1.8.2 rejects queued
write failures and permits a later successful full snapshot to recover. Keep
unsaved edits and return a safe failure to the view; disk details belong in
diagnostics. Older SDK flush behavior does not provide this stronger guarantee.
On unload/restart/host shutdown, FDO awaits tracked public flush/dispose hooks
before terminating the worker, with a five-second deadline and diagnostic failure
reporting. A replacement worker waits for this barrier. Lifecycle init/render
remain synchronous. JSON is not encrypted; credentials belong in the secret vault.

Live UI guidance and AI Coding evidence include these contracts and the installed
SDK Remote Commands handoff. Static previews remain mock-only. Native and
packaged acceptance must exercise real plugins/networking; SDK mock tests alone
do not verify host implementation or all three operating systems.

Settings → Credentials & SSH owns credential entry, connection profiles, command authorization and trust enrollment. The last selected installed plugin is remembered locally. Choose an installed plugin, save credentials, and select their names when configuring a profile. Obtain the endpoint's `SHA256:` fingerprint over a trusted channel; FDO never automatically enrolls an unverified key. Saved verification is retained for ordinary profile edits; changing the host, port or fingerprint requires confirmation again. There is deliberately no host UI API that reads a secret value back.

## Permissions and identity

Workers receive the adapter before initialization. Requests contain an action and payload; no identity, path, profile credential or encryption key is accepted from the worker. The main process binds the channel to the installed plugin ID at worker creation. A separate random installation namespace in the vault survives upgrades under that host ID. Metadata and declared names cannot select a namespace. Removing a plugin, including GitOps manifest pruning, destroys its namespace; reinstalling creates a new one. Detaching a GitOps subscription preserves plugins and their namespaces because it does not uninstall them. Replacing installed code under the same ID is an upgrade and retains credentials: users should only approve trusted upgrades.

`declareCapabilities()` requests grants. Manage Plugins exposes each grant. Every operation is independently checked against the current host registry, including a second check before returning an asynchronous result. No storage, network or process permission implies a secret/SSH grant. Capability changes cancel active operations and restart the worker when the service capability family changes, reflecting the new grants in SDK configuration.

| Operation | Required grants |
| --- | --- |
| Store/read/delete/list | `secrets.use` + the respective `secrets.set/get/delete/list` operation |
| Profile summaries | `ssh.use` + `ssh.profiles.list`, filtered to profiles authorized for that plugin |
| Remote command | `ssh.use`, `ssh.exec`, `secrets.use`, `secrets.consume`, plus the owner profile's target and exact-command policy |

`secrets.get` returns plaintext to trusted backend code when explicitly granted; it is not required to consume an SSH credential reference. A plugin with plaintext access can exfiltrate or log its own secrets; host encryption is not a sandbox against that plugin. Never return secret values from UI handlers or put them into source, SDK JSON storage, command strings, environment variables or diagnostics.

The legacy backend operator bridge uses a synthetic `window`. The host temporarily removes that synthetic object only during synchronous dispatch of the SDK's backend service methods, restoring it immediately when the promise is returned. The adapter and its replies remain separate from the legacy privileged-action envelope and UI dispatcher. No iframe service bridge is installed.

## Storage

The vault lives in `userData/host-services/vault.sqlite`. Its directory is mode 0700 and the database is 0600 on POSIX; Windows inherits the user's application-data ACL. SQLite transactions, WAL and full synchronous commits provide atomic replacement and crash consistency. Only ciphertext and nonsecret identifiers, size accounting and timestamps are persisted. Ciphertext envelopes bind values to the installation namespace and logical key. Profiles and command policy are encrypted too. There are no application plaintext backups or temporary key files.

Electron 44's synchronous [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) uses the platform credential store; encryption keys never enter plugin workers. Linux permits only `gnome_libsecret` or KWallet backends; `basic_text`, `unknown` and missing providers fail closed, even if availability reports true. Unavailable or locked storage rejects every secret operation, including missing lookups and listing. Settings explains how to unlock/configure the OS store and refresh. This store is local to the OS user/machine and is not a portable credential export.

Limits: keys follow the SDK's 1–128 character case-sensitive ASCII grammar; values are arbitrary strings up to 1 MiB UTF-8. Each installation allows 256 names and 8 MiB of current plaintext-size accounting. Empty strings are valid; only an absent key returns null. Up to 64 encrypted profiles are allowed per installation, each with up to 64 exact command entries of 16 KiB. Namespace writes run synchronously in serialized SQLite transactions. Credential replacement/deletion, profile edits/deletion, grant revocation and worker teardown abort current SSH work. Credentials are resolved fresh for each connection and are not pooled or cached.

The vault keeps the latest 1,000 audit records: host identity, validated action, safe outcome code, request ID and timestamp. Request bodies, values, commands, credentials, stdout/stderr and provider messages are excluded. A malicious backend can still log its own data outside this service; do not grant plaintext reads to untrusted code.

## SSH execution

Profiles bind one exact hostname/IP, port, username, authentication-reference set, trusted fingerprint and authorized consumer (`ssh.exec`). IDs convey no authority and cannot cross plugin namespaces. Creation checks each reference in its owner namespace; execution rechecks every reference and the complete profile snapshot. Removing a reference makes future use fail. By default the command policy matches complete shell strings byte-for-byte; it performs no prefix matching, wildcard expansion or command rewriting. It is not argv-style injection protection. Only enter reviewed literal commands.

Settings → Credentials & SSH → Command access also offers **Allow all shell commands (dangerous)**. This explicit host-owned choice persists optional `policy.allowAllCommands: true` with SSH command authorization. It permits any valid shell string as that profile's SSH user, including destructive commands. Omitted or false retains the exact allowlist; `*` in the list is not a wildcard. The existing list is preserved so disabling unrestricted access restores it. This does not grant capabilities, cross plugin namespaces, bypass trust/credential checks or execution limits, or broaden Git repository authorization. Profile edits invalidate and cancel existing operations as before. Plugins cannot request this flag in `ssh.exec` payloads.

FDO hashes raw SSH host keys with SHA256 and compares OpenSSH base64 fingerprints without padding. A verifier is always installed. Missing or mismatched pins reject, and changed keys need deliberate re-enrollment. No SSH config, jump hosts, proxy commands, agent forwarding or keyboard-interactive authentication is inherited. Passwords, private keys and optional passphrases are supported through references.

The handshake deadline is 10 seconds. Command defaults are 30 seconds and 1 MiB combined stdout/stderr, with host ceilings of 120 seconds and 4 MiB. Excess output is drained and discarded; `truncated` is true. UTF-8 decoding carries split characters across retained chunks. Nonzero exits return results. A clean channel close with no exit-status reports `exitCode: null`; a signal reports `signal`. Premature transport disconnect, authentication, trust and timeout errors reject with safe codes. No command is automatically retried. Connections/channels/timers/listeners are released on every terminal path. **Closing a channel cannot guarantee that a remote process terminates.**

There are at most 32 pending calls per worker and 100,000 unique request IDs per worker session. The adapter uses UUIDs, a 140-second overall response deadline, disconnect cleanup and safe-code-only errors. The host separately enforces pending limits and rejects duplicate IDs. Failures use only ACCESS_DENIED, UNAVAILABLE, LOCKED, TIMEOUT, HOST_KEY_REJECTED, CONNECTION_FAILED or INVALID_REQUEST. Service availability is reported by Settings, not inferred from the SDK handshake.

## Git CLI profile reuse

Profile-aware Git uses the existing SDK `requestOperatorTool("git", payload)`
backend API. No SDK change, `this.git` helper or `git.*` capability is required.
In Settings → Credentials & SSH, choose the owning plugin, create SSH profiles
with their own encrypted key/password references and enrolled fingerprints, enable
Git consumption, and authorize exact repository paths for read and/or push.
Saving a Git-authorized profile enables persistent profile mode. Deleting all
profiles does not disable it: later Git operations fail closed. Only an explicit
host Settings toggle can resume legacy CLI authentication.
One profile can serve several repositories; different repositories on the same
server can use different profiles and keys. Ambiguous matches reject.

Grants are `system.process.exec` + `system.process.scope.git`, `ssh.use`,
`secrets.use` + `secrets.consume`, plus host-owned profile/repository/operation
policy. Neither `ssh.exec` nor `secrets.get` is required. Profiles remain scoped
to one plugin. Authentication is resolved fresh for every operation; rotation,
profile changes/deletion, revocation and plugin teardown cancel active connections.
The existing process confirmation still applies. Private transport replies and
Git audit records do not log command/output bodies.

Supported forms (no extra arguments, custom environment or stdin):

```ts
await requestOperatorTool('git', {
  command: '/usr/bin/git', // Use your installed, allowlisted Git executable path.
  args: ['ls-remote', 'git@github.com:company/service.git'],
  cwd: '/authorized/existing/folder',
  timeoutMs: 30000,
});
// Also: ['clone', url, 'new-child-folder'], ['fetch', url],
// ['push', url, 'refs/heads/main:refs/heads/main'].
```

For fetch/push the cwd is the existing working copy. Clone accepts a new direct
child folder name. Push requires an explicit branch-to-branch refspec; force,
delete and mirror are excluded. A timeout/disconnect cannot prove a remote push
was rolled back. No automatic retry. The host captures at most 1 MiB of combined
Git stdout/stderr, drains further output and reports `truncated` when needed.

Both scp-style and ssh:// URLs work. The hostname, port, username and exact
case-sensitive repository path must match the authorized profile. Relative
`git@host:team/repo.git` matches `team/repo.git`; absolute
`ssh://git@host:2222/team/repo.git` matches `/team/repo.git`. Profiles do not resolve
SSH aliases, user SSH config, jump hosts or agents. Enroll host-key trust through
Settings; missing/changed trust rejects. Git-only servers need no shell probe.

Profile mode supports explicit URLs and named remotes, including distinct push
URLs. Pull defaults to `--ff-only`; explicit `--rebase`/`--no-rebase` are available.
Flags use an operation-specific allowlist (branch/depth/filter for clone,
prune/tags/depth for fetch, recursive submodules and read-only output controls).
Arbitrary configuration, shell overrides, custom helpers and force/delete/mirror
pushes remain excluded. Submodule add/update/status/init/sync are supported;
every auxiliary target must have its own repository authorization. Relative
submodule URLs are resolved against the parent and checked again during transport.

Bundled Git LFS supports fetch/pull/push/checkout/status/ls-files/version. Clone,
pull and submodule update hydrate LFS pointers; pushes upload LFS objects through
a host-controlled step before sending Git refs because repository hooks are
disabled. LFS uses the same pinned SSH transport. Hybrid SSH/HTTPS transfers
pass through a short-lived authenticated CONNECT proxy: the profile hostname on
port 443 is allowed; additional HTTPS server/CDN origins require explicit
`policy.lfsHttpsOrigins` entries in Settings (for example
`https://*.githubusercontent.com`). SSH keys and passphrases never reach Git/LFS.
Standalone HTTPS Git credential helpers remain a separate integration.

### Calling advanced Git operations

These operations use the existing backend `requestOperatorTool('git', payload)`
API; no SDK update is required. The Git template's `index.ts` demonstrates this
call, and `git-executable.ts` detects the installed executable. Its initial UI
offers only `ls-remote`; the other operations are available to backend handlers.
Use the detected executable as `command` and an authorized working copy as `cwd`:

```typescript
const result = await requestOperatorTool('git', {
  command, cwd,
  args: ['fetch', '--prune', 'origin'],
  timeoutMs: 30000,
});
// Other args examples (each is a separate deliberate operation):
// ['pull', '--ff-only', 'origin', 'main']
// ['submodule', 'update', '--init', '--recursive']
// ['lfs', 'fetch', 'origin']
// ['lfs', 'pull', 'origin']
```

Named remotes are resolved from the working copy. Configure the matching
repository and allowed operation on its profile in Settings → Credentials & SSH.
Each submodule requires its own matching repository authorization. Custom options
are limited to the operation-specific allowlist in `gitPolicy.cjs`; arbitrary
`-c` configuration and custom transport/helper commands are rejected. This uses
the existing independent Git process, SSH and secret-consumption grants described
above. The optional typed SDK Git API remains future work.

Plugins with Git-authorized profiles reject unsupported network command syntax
rather than bypassing profile selection. Local inspection retains existing CLI
behavior. SSH-capable plugins that have not configured profile mode fail closed until a Git profile is enrolled; an absent setting is distinct from an explicit legacy opt-out. Plugins without SSH grants, or those explicitly disabling profile mode in Settings, retain noninteractive legacy Git behavior;
this does not grant access to saved profile credentials. Generic UI privileged
requests do not gain this private backend credential consumer. GitOps synchronization
is separate and does not automatically use these profiles.

The host launches Git with a bundled binary-safe streaming adapter backed by
`ssh2`, not buffered `SSHClient.exec`. An expiring operation-scoped random handle with bounded authenticated sessions
authenticates the helper to its loopback host channel. Credentials never cross
that channel or enter argv, environment, Git config or temporary key files.
Git destinations are checked again when the helper connects; URL rewrites cannot
redirect the selected credential. Host settings disable hooks, fsmonitor, inherited
global/system configuration, other protocols, implicit submodule recursion and automatic
maintenance. The host also sets `GIT_ALLOW_PROTOCOL=ssh`, which overrides repository protocol settings ([Git environment contract](https://git-scm.com/docs/git#Documentation/git.txt-GITALLOWPROTOCOL)). The Git starter detects installed Git using host-mediated, read-only version checks against common platform-specific allowlisted paths, with an optional path override. Git must be installed separately; FDO supplies the pinned SSH transport without requiring an external SSH executable.

The SSH connections and Git with SSH profiles creation templates demonstrate
existing SDK APIs. AI Coding retrieves shared host contract evidence; Live UI
shows setup guidance and preserves backend handlers while previews remain mock-only.
Both templates display deliberately selected command stdout/stderr in read-only
text boxes and include parsing examples in `logic.ts`. The Git template configures
its URLs, Git executable and working folder in `repositories.ts`; users select a
repository before running read-only `ls-remote`. This lists configured repositories,
not SSH command profiles. Git-only profile matching remains host-owned and uses
the effective repository endpoint and policy, with `ssh.use` plus its `ssh.exec` child. Git-only profiles still do not authorize general shell commands.
The Git template declares its full six-capability bundle in `permissions.ts` and
reports every missing grant from the worker's configured permissions. The SSH execution child is approved separately from the SSH base grant. Git process execution, Git scope and secret consumption are also independent approvals.
Saving SSH access without a selected operation is blocked in the capability editor. Granting
only `ssh.use` leaves execution disabled; after approving and saving the remaining
grants in Manage Plugins, refresh repositories. Backend preflight repeats on each
command; host enforcement and profile policy remain authoritative.
The [SDK Git handoff](./SDK_PROFILE_AWARE_GIT_HANDOFF.md) describes an optional future
typed API, not a prerequisite for the current CLI integration.

The runtime packages `ssh2` and its JavaScript dependencies under `dist/main/node_modules`; optional native accelerators are deliberately excluded. No installed SSH executable is needed. Existing plugins need no new grants unless they adopt these services.

### Verification boundary

Unit tests cover isolated namespaces, each missing capability, strict requests, quotas, encrypted persistence, provider failures, trust pins, command policy, output/UTF-8 limits, deadlines, revocation and teardown. Loopback tests use the actual bundled ssh2 implementation with password and encrypted private-key authentication. `tests/e2e/host-services.spec.js` runs a real signed plugin through Settings credential entry, OS encryption, the worker bridge and a pinned local SSH server, then revokes its consumption grant.

Development Electron verification is not packaged-host certification. Before announcing complete cross-platform integration, run this end-to-end flow in packaged, signed Windows/macOS/Linux hosts with no SSH executable available, including locked OS stores and Linux plaintext fallback rejection. Verify the vault and diagnostic logs contain no credential plaintext, the copied ssh2 dependency tree is present, and uninstall/reinstall cannot recover the previous namespace. Packaging and signed OS keychain identity must be verified on each target OS. Do not describe the SDK handshake alone, mocked bridge tests or a development build as that release evidence.

CI now runs the host-service test in development hosts and unpacked packages on Linux, Windows and macOS. After `npm run build` and `npx electron-builder --dir --publish never`, use `node scripts/run-packaged-host-services.cjs` (Linux: wrap this with `bash scripts/run-linux-e2e.sh`). The runner selects the built executable and writes separate packaged-service reports. Its fixture blocks external SSH launches explicitly. Local verification exercised the unpacked macOS arm64 application; Windows/Linux CI and signed-release keychain verification still need their actual platform runs.


## Retrieving a host-key fingerprint before the first login

In the host Settings SSH profile editor, enter the hostname and port and choose
**Fetch host key**. FDO uses bundled ssh2 to collect the negotiated public host key
and immediately reject it before authentication. It sends no saved credential,
opens no session and saves no profile. The candidate's endpoint, key type and
SHA256 fingerprint are displayed for review. Applying it never selects the trust
checkbox. A different key on an existing profile is explicitly highlighted.

Discovery is bounded to four concurrent requests with an eight-second deadline.
It is available only to the host main frame, not plugins or iframes. Navigation,
renderer exit, plugin invalidation and app shutdown cancel pending scans. Audit
records contain identity/action/outcome/request ID, not the key or request body.

A network observation does not establish host authenticity. Compare the candidate
with an administrator, provider documentation or a trusted cloud/physical console
before confirming trust. For a manual Ed25519 scan from a computer with OpenSSH:

```sh
ssh-keyscan -T 5 -p 22 -t ed25519 example.com | ssh-keygen -lf - -E sha256
```

For independent verification, an administrator can run this on the server's
trusted console:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Replace host, port and key type as appropriate. Servers may offer several keys;
FDO's fetch action reports the key negotiated by its own SSH client. These commands
do not enroll known_hosts entries. See the OpenSSH manuals for
[ssh-keyscan](https://man.openbsd.org/ssh-keyscan) and
[ssh-keygen](https://man.openbsd.org/ssh-keygen).

Legacy Git runs SSH with BatchMode=yes and StrictHostKeyChecking=yes, and disables Git terminal prompts. Unknown host keys and authentication requests reject instead of waiting on the app terminal. Profile-backed Git always uses the pinned ssh2 transport; no interactive trust enrollment happens during execution. The Git starter uses a 10-second operation deadline below the 15-second UI handler deadline.

GitOps ships a pinned Dugite Git runtime (with Git LFS), staged and architecture-checked
for Windows, macOS and Linux packages. It does not depend on PATH or system Git.
Plugin CLI requests continue to use an installed, allowlisted Git executable.
SSH profile summaries returned by the backend include host, port, username,
authenticationType and trustedHostKey; credential values, reference keys and
command policies are omitted. The SDK facade must preserve these safe summary
fields before typed `listProfiles()` callers can display them.

GitOps updates that request capabilities beyond the plugin's current grants are
staged as signed candidates. The installed version keeps running until Settings
approval. Review shows the installed and candidate commits and requires an
individual selection for every additional permission; parent and child grants
remain independent. Declining retains the installed version and suppresses that
exact candidate until “Review again” is selected. Newer commits receive a new
review. Approval rechecks the signature, source identity and current grants before
applying code and the explicitly selected grants together. A failed startup
restores the installed version and previous permissions.

Candidate capability declarations are inspected without executing candidate code.
Static arrays, constant aliases and installed SDK capability factories are
supported. Dynamic or otherwise uninspectable declarations block approval and
keep the installed version; maintainers must provide an inspectable declaration.
New GitOps installations remain disabled and receive no automatic grants.

Interactive SSH terminals (SDK 1.8.3) use the optional `openSSHTerminal` adapter,
separate authenticated `terminal.*` operations and worker-owned random handles.
`ssh.use`, `ssh.terminal.open`, `secrets.use` and `secrets.consume` are individually
required. Profile policy must explicitly include consumer `ssh.terminal.open`;
old profiles retain their current policy and default to no terminal/X11 consent.
`ssh.exec`, command allowlists, `allowAllCommands` and Git authorization never
supply that consent. Profile discovery includes explicitly interactive profiles.
No plaintext `secrets.get` permission is required.

The shipped iframe injects `window.FDOTerminal`, backed by host-owned xterm.js
and FitAddon, with binary writes and consumed callbacks, keyboard/paste/IME,
resize subscriptions, explicit focus, size, reset and disposal. OSC 52 clipboard
writes and automatic link navigation are denied. It exposes no credentials,
local display addresses, sockets or X11 cookies. Terminal output is untrusted
VT data, never HTML, and is not stored as a transcript or logged by the host.
Frontend types, AI Coding retrieval and Live UI host guidance describe this flow;
static previews must not open sessions.

Limits are four terminals per worker, 16 globally, five-minute idle and one-hour
absolute ceilings, 32-KiB packets, 64-KiB pause and 256-KiB hard application output
queues. Conservative shared provider/socket reservations are capped at 256 MiB
(12 MiB per terminal, 16 MiB per X11 channel; at most 32 forwarded channels).
Backpressure fails instead of dropping terminal bytes. Control/write deadlines
are independent of output reads. Worker transports reserve eight of 32 pending
request slots for EOF/cancel/close. Same-worker bounded tombstones make close and
cancel idempotent. No shell opening is retried after a lost acknowledgement.

An authenticated main-window iframe lease is renewed every ten seconds and
expires after 30 seconds. Iframe replacement/unmount, renderer loss, worker
teardown, revocation, credential rotation and profile changes close resources.
Pending opens are owned before local display discovery/authentication. Host
shutdown awaits cleanup before closing storage. Socket/channel closure and
cancellation report unknown remote termination; they cannot prove background
jobs or descendants stopped.

X11 is separate: require `ssh.x11.forward`, interactive access and an exact
`policy.x11Modes` consent. Trusted mode discovers only host-owned DISPLAY and
XAUTHORITY, uses a fixed bounded xauth invocation and authenticates a local
MIT-MAGIC-COOKIE-1 display before requesting forwarding. Unix Xorg/Xwayland and
XQuartz sockets and explicitly configured authenticated loopback displays are
supported by this adapter. Incoming channels must authenticate with a random
per-session spoof cookie before a local socket opens; only the host substitutes
its local cookie. Missing tools/display/authentication fail closed. Windows local
display discovery is unsupported. Untrusted mode uses the host-owned X SECURITY adapter described below.
Actual graphical desktop acceptance on Linux, macOS and Windows remains
unverified; simulated-display negotiation tests are not desktop verification.
No trusted fallback, public listener or xhost bypass is provided.

Untrusted X11 now uses X SECURITY 1.0 directly over the authenticated local
X connection; it does not run `xauth generate` or write a temporary authority file.
After querying the extension/version it generates an authorization with trust
level Untrusted, revocation events and a 60-second server inactivity timeout.
FDO authenticates a second connection with that cookie and requires both hidden
SECURITY access and denial of GetImage on a valid, zero-filled trusted pixmap.
The trusted control must successfully read the same pixmap first. Generation
alone is not considered proof of isolation. A fresh restricted sentinel remains
connected during the lease, so normal idle time does not unexpectedly expire it.

The host enforces an absolute maximum five-minute authorization lifetime even
when X clients remain connected. Expiry or a lost/revoked authorization closes
forwarding and the terminal; normal close/revocation/shutdown waits for explicit
RevokeAuthorization and a round-trip barrier. Only the generated authorization
ID is revoked. If the control connection drops, the host attempts one bounded
reconnection to revoke that ID, closes all local clients and fails closed. If
the X server is unreachable or the host crashes, the server inactivity timeout
purges the now-unused authorization; it is not an absolute lifetime guarantee.
Cookies, authorization IDs, display/socket paths and protocol replies never cross
plugin or Settings IPC and are never persisted or logged.

Profiles separately consent to trusted and/or untrusted mode. The main-window-only
Check local X11 support action creates, verifies and revokes a temporary untrusted
authorization and returns timestamped availability/safe codes for each mode.
Every terminal opening repeats verification; a previous check is not a grant or
an availability guarantee. Missing SECURITY, ineffective isolation or failed
authorization never falls back to trusted mode. Windows local display discovery
remains unsupported. See the [X SECURITY specification](https://xorg.freedesktop.org/archive/X11R7.7/doc/xextproto/security.html)
and [Xorg security implementation](https://github.com/mirror/xserver/blob/master/Xext/security.c).

XQuartz launchd addresses may live below `/tmp`, `/private/tmp`, `/var/run`, or `/private/var/run`. FDO recognizes these addresses, looks up the matching local `:N` authorization, and connects to `/tmp/.X11-unix/XN` directly. The launchd handoff can treat a generated untrusted cookie as trusted; it must not carry restricted connections. No fallback to the handoff occurs when the direct socket is unavailable. Start XQuartz before checking support. The availability result separates display-format/platform errors from X SECURITY negotiation and isolation failures using fixed, nonsecret reason codes. Real XQuartz verification covers trusted-resource denial, active expiry, revocation, and preservation of the original desktop authorization.

### Local display authorization continuity

The authority database is shared with tools such as sshd/xauth. A timestamp change or atomic replacement of `.Xauthority` is not itself credential revocation: the same user may SSH back to this machine, causing sshd to add a different display's forwarding entry.

FDO selects the exact local record with the fixed host `xauth nlist` lookup and keeps its record identity (family, address, display number, protocol) and cookie in host memory. `isCurrent()` reads a bounded snapshot of the authority file and compares that record and cookie. Unrelated entry changes, reordering, touching the file, and atomic replacement preserving the selected record keep the session valid. Missing, duplicate/ambiguous, malformed, oversized or unreadable data fails closed. Removal/rotation of the selected record, DISPLAY/XAUTHORITY changes, or disposal permanently invalidates the handle. Cookie comparison uses constant-time comparison; buffers containing database bytes are cleared after checking. No timestamp cache can hide a same-size, same-mtime rotation. Existing generated untrusted authorization lifetime, control/sentinel connection checks, revocation, profile grants, and cleanup remain enforced independently.

After a host-only change, fully quit FDO, run `npm run build:main` from the checkout and launch that checkout with `npx electron .` (or use `npm start` for the watch-mode development build). A packaged installation uses its embedded bundle: build the application/package and launch or install the newly produced app. Building this repository alone does not update an existing app in `/Applications`. Recheck local X11 availability, then deliberately open the original profile with the original X11 mode. An iframe reload alone does not restart the host process. No automatic command retry or mode fallback is performed.
