# SDK handoff: Git operations using reusable SSH profiles

Status: optional future typed API proposal, not implemented in the SDK.
The host now integrates SSH profile consumption through the existing Git CLI
operator API, without SDK changes or new git.* capabilities. See
[the current host contract](./HOST_SECRETS_AND_SSH.md#git-cli-profile-reuse).
This proposal is not a prerequisite for that integration.

## Safe profile metadata: immediate additive SDK change

The host's existing `ssh.profiles.list` response now includes `host`, `port`,
`username`, `authenticationType` (`password` or `privateKey`) and `trustedHostKey`
alongside `id` and `label`, filtered by caller authorization. It omits secret
values, reference keys, passphrases and command bodies.

SDK 1.8's `listProfiles()` currently maps each result to `{id, label}` and drops
the new fields. Extend `SSHProfileSummary` and that allowlisted runtime mapping
to preserve these safe fields. Make the additions optional for compatibility
with older hosts and validate each field independently; never spread the raw
profile object into SDK results. This uses the existing action and independent
`ssh.use` + `ssh.profiles.list` grants. No new permission or CRUD API is needed.
Update SDK facade tests and release the SDK before templates promise that typed
`listProfiles()` exposes this metadata. This SDK edit is separate from the
optional typed Git API below.

## Goal and ownership

A plugin can operate on repository A using SSH profile A, and repository B using
SSH profile B, including when both repositories use the same Git server and SSH
username. The host binds each repository to a profile; a global Git credential or
“default SSH profile” must not override these bindings.

Reuse `SSHConnectionProfile` and the existing plugin-owned secret namespace.
Do not introduce a second kind of credential-bearing “Git profile.” Add a
host-owned Git repository registration containing a stable ID, label, canonical
SSH URL, SSH profile ID, allowed operations and managed workspace policy.
Credentials, trust enrollment, repository registrations and profile assignment
remain in host Settings. Profile IDs and repository IDs are identifiers, not grants.

A repository registration and its selected profile must belong to the same
plugin. Cross-plugin sharing is outside this release. Resolve bindings and grants
again for every operation. Return metadata to plugins, never authentication fields
or secret references. No SDK profile/repository CRUD in this iteration.

## Public SDK additions

Add and export `GitClient`, expose a readonly `this.git` on `FDO_SDK`, and export
these types. Preserve synchronous `init()` and `render()`; register asynchronous
handlers during `init()`.

```ts
export type GitOperation = 'listRefs' | 'clone' | 'fetch' | 'push';
export type GitRepositorySummary = {
  id: string;
  label: string;
  url: string; // Credential-free canonical SSH URL, suitable for display.
  sshProfile: SSHProfileSummary; // Safe summary above; no credential references or values.
  operations: GitOperation[]; // Host policy intersected with current caller grants.
};
export type GitRef = { name: string; oid: string };
export type GitWorkspace = {
  id: string; // Opaque host-managed workspace handle, never an arbitrary local path.
  repositoryId: string;
};
export type GitOperationOptions = {
  repositoryId: string;
  timeoutMs?: number;
};
export type GitWorkspaceOptions = GitOperationOptions & { workspaceId: string };
export type GitPushOptions = GitWorkspaceOptions & {
  updates: { sourceRef: string; destinationRef: string }[];
};
export type GitListRefsResult = { refs: GitRef[] };
export type GitCloneResult = { workspace: GitWorkspace; durationMs: number };
export type GitTransferResult = { durationMs: number };
```

Facade methods:

```ts
declare class GitClient {
  listRepositories(): Promise<GitRepositorySummary[]>;
  listRefs(options: GitOperationOptions): Promise<GitListRefsResult>;
  clone(options: GitOperationOptions): Promise<GitCloneResult>;
  fetch(options: GitWorkspaceOptions): Promise<GitTransferResult>;
  push(options: GitPushOptions): Promise<GitTransferResult>;
}
```

`clone` creates a host-managed working copy. Fetch/push require a caller-owned
workspace handle bound to that repository. No caller-supplied cwd, Git flags,
environment, SSH command, Git executable, credential, URL or profile override.
Repeated clone may create another workspace subject to host quota; do not silently
switch existing workspace ownership or its repository binding. Host workspace
editing/file access is a separate contract, not implied by these methods.

Push is explicit and never automatic: named source/destination refs only; no
wildcards, deletion, force, mirror or raw refspecs in v1. Source refs must exist in
the selected workspace; destination refs and non-fast-forward policy are validated
by the host and Git server. A push rejection rejects the operation. Do not claim
that a timeout means the remote repository was unchanged. Do not retry pushes.

Return structured results, not raw Git output. Validate response fields, IDs,
finite nonnegative durations, operation enum values, ref names and object IDs
(SHA-1 or SHA-256); bound arrays/strings. Never interpolate malformed host data
into errors. The host defines time, transfer, workspace and disk ceilings and may
reject before a result exceeds protocol limits; never silently return partial refs.

## Exact transport additions

Extend `HostServiceRequest` with:

| Action | Payload sent to host | Direct result |
| --- | --- | --- |
| `git.repositories.list` | `{}` | `{ repositories: GitRepositorySummary[] }` |
| `git.listRefs` | `{ repositoryId, timeoutMs }` | `GitListRefsResult` |
| `git.clone` | `{ repositoryId, timeoutMs }` | `GitCloneResult` |
| `git.fetch` | `{ repositoryId, workspaceId, timeoutMs }` | `GitTransferResult` |
| `git.push` | `{ repositoryId, workspaceId, timeoutMs, updates }` | `GitTransferResult` |

Facade default deadline: 120,000 ms. Accept positive safe integers, at most
600,000 ms; the host may impose lower ceilings. Host worker pending-request and
transport deadlines must accommodate the supported operation deadline and cleanup
rather than retaining the existing SSH-only 140-second transport ceiling.

Use the existing authenticated `configureHostServices({ request })` transport and
safe `HostServiceError` conversion. These are direct results, not the legacy
privileged-action envelope. Reject calls from the iframe, reject unknown fields,
and never include plugin identity in payloads. The host derives identity from the
worker binding. SDK capability checks improve feedback; host checks authorize.

Add `HostServiceErrorCode` values `GIT_FAILED` and `UNSUPPORTED` in both SDK and host.
`GIT_FAILED` covers repository/protocol/ref/push rejection without raw provider
messages. `UNSUPPORTED` identifies an unavailable host action/version. Preserve
existing safe errors for permissions, validation, storage, deadlines, host-key and
connection failures. No stderr, remote command, credential or URL userinfo in errors.

An older host may return `UNAVAILABLE` for new actions. Fail clearly; never fall
back to `requestOperatorTool('git', ...)`, external SSH or unverified host keys.
SDK version/handshake alone does not establish host feature readiness.

## Capabilities and bundle helper

Add these names to the capability union, discovery, descriptions, bundle helpers,
preflight and tests; the host must independently add consent, grants and revocation:

```
git.use
git.repositories.list
git.listRefs
git.clone
git.fetch
git.push
```

Required grants:

| Operation | Grants |
| --- | --- |
| List repository metadata | `git.use` + `git.repositories.list` |
| List refs / clone / fetch / push | `git.use` + its specific `git.*` operation + `ssh.use` + `secrets.use` + `secrets.consume` |

Repository listing does not consume credentials. It includes only caller-owned,
authorized bindings and only operations currently granted. Listing alone grants
no execution. Execution also requires host repository, target, profile-consumer
and operation policy. `ssh.exec`, `ssh.profiles.list` and `secrets.get` are not
required for Git authentication and must not be inferred or bundled automatically.

Add `createGitCapabilityBundle(operations)` accepting `'repositories.list'`,
`'listRefs'`, `'clone'`, `'fetch'`, `'push'`. Require an explicit operations array:
no default that silently requests push. Include `git.use`; include SSH/secret
consumption prerequisites only when an execution operation is requested. Reject
unknown entries and deduplicate like existing bundle helpers.

This dedicated service does not expose arbitrary local process execution. Keep
existing operator Git calls governed by `system.process.exec` and
`system.process.scope.git`; they still have no profile binding. If the host reuses
that existing operator execution path, retain those grants in addition to the new
repository/profile authorization. Do not conflate the two APIs or upgrade existing
operator grants to Git secret consumption. The host must document which execution
path it ships before templates request any additional process grants.

## Example for two repositories

```ts
class RepositoryInspector extends FDO_SDK {
declareCapabilities() {
  return createCapabilityBundle([
    ...createGitCapabilityBundle(['repositories.list', 'listRefs']),
  ]);
}

init(): void {
  PluginRegistry.registerHandler('inspectRepositories', async () => {
    const repositories = await this.git.listRepositories();
    const results = [];
    for (const repository of repositories) {
      if (!repository.operations.includes('listRefs')) continue;
      const { refs } = await this.git.listRefs({ repositoryId: repository.id });
      results.push({
        repository: repository.label,
        profile: repository.sshProfile.label,
        refs,
      });
    }
    return { results }; // Intentionally selected nonsecret UI data only.
  });
}
}
```

Host Settings example for the same plugin:

- `personal-app`: `ssh://git@github.com/alex/personal-app.git` → `personal-key` SSH profile.
- `work-service`: `ssh://git@github.com/company/work-service.git` → `work-key` SSH profile.

Each profile has its own private-key secret reference and enrolled host-key trust.
A profile may also serve multiple explicitly authorized repositories. A profile may
be authorized for Git only, without any shell-command policy.

## Host implementation obligations (not SDK functionality)

The SDK is a facade. The host must implement reusable profile policy, repository
Settings, ownership, workspace management, grants, revocation and a real Git
transport. Existing buffered `SSHClient.exec` cannot carry Git protocol data.

For a Git CLI backend, ship a binary-safe bidirectional SSH helper backed by
`ssh2`, authenticated with short-lived single-operation handles. Support
backpressure, stdin EOF/half-close, stderr, exit status, deadlines and cleanup.
Never put keys/passphrases in argv, environment, temporary key files or Git config.
Bundle/select Git separately or document its prerequisite; bundling SSH is not
bundling Git. Verify helper execution and packaging on all three operating systems.

Match the effective hostname, port, username and repository to the binding. Keep
Git-generated service commands under host control (`git-upload-pack` for reads,
`git-receive-pack` for push). Enforce enrolled host keys and support Git-only
servers without shell probes. Control Git config, rewrites, hooks, custom helpers,
SSH overrides, agent forwarding and environment. Reject auxiliary destinations
(submodules, LFS, recursive transfers) in v1 rather than inheriting profile access.
HTTPS credential consumption is a separate feature.

Profile edits/deletion, credential rotation/deletion, repository reassignment,
capability revocation, uninstall and worker/host shutdown must invalidate affected
operations and cached authentication. Do not mix profile revisions in one request.
An edit must not silently transfer an existing workspace to another repository.
Audit identity/action/outcome/request ID only; no request bodies, secrets, remote
commands or raw Git output. Remote disconnect cannot guarantee cancellation of a
server-side mutation.

## SDK deliverables and verification

Update `src/types.ts`, `src/utils/hostServices.ts`, capability helpers/metadata,
`FDO_SDK` properties, public exports/declarations and `docs/SECRETS_AND_SSH.md`.
Add a Git usage example and migration notes. Existing plugins need no new grants.

SDK unit tests must cover exact action/payload/result contracts, all missing
base/specific/prerequisite capabilities, empty lists, malformed responses and
inputs, backend-only access, unconfigured/disconnected/reconfigured transports,
safe error conversion and no accidental privileged-envelope fallback. Demonstrate
two repositories with different profile summaries. Add export/type and facade
lifecycle tests. The tests mock transport; do not claim host encryption/networking
or packaged Git is verified by SDK tests.

Once both sides support this contract, FDO should add two creation templates:
SSH commands with authorized profiles, and Git repository operations displaying
each repository's selected SSH profile. Update the shared plugin authoring guide
used by Live UI and AI Coding, the SDK knowledge evidence and retrieval tests.
Teach both tools to keep service calls in async backend handlers with synchronous
lifecycle methods, select only required grants, send only deliberate nonsecret
results to the UI, and explain host Settings setup. Do not generate API calls
until the installed SDK declarations and host implementation support them.

Release acceptance requires a real plugin using two repositories on the same
endpoint with different keys, host UI enrollment, encrypted private keys,
Git-only accounts, repository read/write separation, binary integrity, endpoint
mismatch and malicious Git configuration rejection, revocation and helper replay
prevention, without an installed SSH executable on packaged Windows/macOS/Linux.
