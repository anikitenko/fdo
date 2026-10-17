# GitOps repository collections

Settings → GitOps manages repositories that contain an FDO `PluginCollection`.
Collections are synchronized when saved, at startup, and at a configurable
interval while FDO is running (five minutes by default). Each repository has a
Blueprint TimePicker for its interval, from `00:01` to `23:59` in hours:minutes.
Choose **Save interval** to persist it. This is a duration, not a time of day.
**Sync now** checks the collection immediately; **Automatic synchronization** can
be paused per repository. No license or paid subscription is required.

Repository summaries collapse independently and show their URL, revision, plugin
count, and status. Expand **Plugins** to see every declared plugin, including ones
that could not be installed. Each row shows the repository, declared revision,
installed commit, last check, and its own error. **Check for updates** checks and
applies updates for that plugin alone, preserving all other installed plugins.
An unavailable version is a collection issue: retry later or contact its maintainer;
subscribers do not need to select a replacement revision themselves.

Choose **Add Git Repository**, then enter:

- An HTTPS Git repository URL, without credentials or query parameters.
- A branch name or release tag (the actual Git tag, not a release title).
- The manifest path relative to the repository root, such as `fdo-plugins.yaml`.
- Optional username and access token/password for this repository. For GitHub,
  use your account username and a personal access token with repository read access.

**Verify and save** fetches the selected revision into a temporary bare Git
repository, reads the manifest without checking out or executing repository code,
and validates it. Failed verification does not save changes. Git must be available
on PATH. Each Git command has a 30-second timeout. HTTP redirects are rejected;
enter the final repository URL. SSH and interactive OAuth are not yet supported.

Credentials are encrypted as a separate pair for each collection repository using Electron
`safeStorage`, backed by the operating system's credential protection. They are
not stored in Git configuration, passed as command-line arguments, returned to the
Settings UI, or shared between collections. A collection's credentials are used
for its declared plugin repositories only on the same HTTPS origin; repositories
on other origins are accessed without credentials. Credential storage fails if secure
encryption is unavailable, including Linux's `basic_text` fallback. Credentials
must be re-entered if the OS keychain can no longer decrypt them. Removing a
repository also removes its encrypted credentials and detaches its installed
plugins, leaving them available as ordinary local plugins.

Edit a repository to replace credentials, or leave both credential fields blank
to retain them for the same URL. Changing the URL requires entering credentials
again. Choose **None** to delete its saved credentials. **Verify again** checks
the saved configuration and refreshes its collection snapshot and commit.
Verification establishes read access, not the identity of an account: public
repositories may accept requests even when the provided credentials are invalid.

## Manifest format

```yaml
apiVersion: fdo.dev/v1alpha1
kind: PluginCollection

metadata:
  name: azure-devops
  displayName: Azure DevOps Toolkit
  description: Essential Azure DevOps plugins
  version: 1.2.0
  maintainers:
    - github: alexvwan

spec:
  plugins:
    - name: azure-resources
      repository: https://github.com/acme/fdo-azure-resources
      targetRevision: v1.3.0
      path: /

    - name: azure-cost-analyzer
      repository: https://github.com/acme/fdo-azure-cost
      targetRevision: main
      path: /plugin

    - name: azure-pipelines
      repository: https://github.com/acme/fdo-azure-pipelines
      targetRevision: v2.1.0
      path: /
```

Validation requires the exact `apiVersion` and `kind`, `metadata.name`,
`metadata.version`, and between 1 and 100 plugin entries. `displayName`,
`description`, and `maintainers` are optional. Each maintainer identifies a GitHub
username. Each plugin requires a unique `name`, HTTPS `repository`, Git
`targetRevision`, and `path`. `/` means the plugin repository root. Names use
lowercase letters, numbers, and hyphens, with at most 63 characters.

`github: anikitenko` identifies the GitHub username and is displayed as a link to
`https://github.com/anikitenko`. This is a profile reference, not proof of authorship.

Unknown fields, duplicate YAML keys, multiple YAML documents, unsafe paths,
embedded URL credentials, and manifests larger than 256 KiB are rejected. Up to
30 collection repositories can be saved.

## Installation and updates

Each declared plugin is fetched at `targetRevision` (branch, tag, or commit), using
its `path` as the plugin root. That directory must contain `package.json`.
There is no `revisionType` field in a plugin declaration. A full 40-character
commit SHA pins that commit. Otherwise, FDO looks up the actual remote refs:
an exact tag takes precedence over an exact branch with the same name. Branches
follow new commits; tags follow the named tag and do not advance automatically
to newer versions. Names such as `v1.0.0` are not assumed to be tags. To select a
particular ref when names collide, `targetRevision: refs/heads/release` or
`targetRevision: refs/tags/release` can be used. Abbreviated commit SHAs are not
supported. The collection repository's Settings branch/tag selector is unchanged.

Source plugins may declare `source`, point `main` at TypeScript (for example
`main: index.ts`), or provide the conventional `index.ts` / `index.tsx` entry.
They use the editor's existing compiler, metadata extraction, and build-artifact
selection; authored source files are preserved and the compiled bundle is signed.
Source metadata, including `author`, comes from the plugin code and does not need
to be duplicated in `package.json`. Prebuilt plugins declare a JavaScript `main`
(default `dist/index.cjs`). Source metadata is read
from the existing plugin metadata declaration. Prebuilt plugins use package
`version`, `author`, `description`, and optional `fdo.icon` (default `application`).
No package installation scripts are executed. Dependencies must be available in
FDO's existing build environment or bundled in a prebuilt plugin.

Every new code version is signed automatically with the default `root` certificate
and verified before installation. This local signature records FDO's acceptance
of the downloaded code; it does not attest to the maintainer's identity. Remote
signature files and `.fdoignore` are replaced by FDO's signing configuration.
Each plugin is prepared before its registry entry changes. Checks run independently,
so an unavailable plugin does not block healthy plugins in the same collection.
An active plugin reload failure restores that plugin's previous version. Existing permissions are retained;
new plugins start disabled with no granted capabilities. Enable plugins and grant
permissions through the usual Manage Plugins controls.

Internal IDs use `gitops_<collection-id>_<declared-name>`, so plugins with the same
declared name from different collections coexist with separate data and permissions.
Successful plugin updates show a green notification in the top-right corner for ten seconds, including the plugin name and installed commit. This appears throughout the app, even while another plugin is selected. Each update is also saved as an unread success notification with expandable version, revision, full commit, and repository details. Use its actions to view the plugin, open its repository, or jump to its GitOps subscription. Viewing a disabled plugin opens Manage Plugins without enabling it. Unchanged checks are silent. Active plugins reload automatically; their temporary UI state may reset.

The notification bell shows the unread count and opens history directly. History supports All, Unread, and Needs attention filters, source filtering, full-text search including collapsed details, individual read/unread controls, and dismissal with a 12-second Undo window. Repeated GitOps failures update one incident with an occurrence count and latest timestamp; a successful retry marks it resolved. Retry is available directly on an active incident. Repeated identical failures from other sources are grouped too.

The notification panel's preferences control success, warning/failure, and informational toasts, plus source muting. Muted events still enter history. History is retained until dismissed by default, with optional 30- or 90-day retention. Preferences and history survive app restarts; shortening retention removes expired history immediately.

Manage Plugins shows a prominent **GitOps** button for managed plugins. Click it
to open read-only details: installed source, declared name and internal ID, full
commit, signature verification and certificate, collection repository and manifest,
automatic check schedule, and latest synchronization status. No credentials are
displayed. Local deployments and
individual removal are blocked until the subscription is removed; update code in
Git instead. Removing a declaration from a collection removes its managed plugin
on the next successful synchronization. Plugin data is retained.

GitOps rejects symlinks and submodules, limits a plugin tree to 2000 files, and
allows at most 10 MiB per file and 50 MiB per plugin. `node_modules` is not copied.
Failed synchronization is displayed in Settings and does not replace working code.
