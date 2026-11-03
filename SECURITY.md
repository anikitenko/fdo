# Security policy

## Supported versions

FDO is preparing for its first release. Security fixes currently target `main`
and the latest prerelease, when available. Older prereleases and development
snapshots are not maintained separately. After stable releases begin, fixes will
focus on the latest stable release; support for older release lines will be
announced explicitly.

## Report a vulnerability privately

Email [me@alexvwan.me](mailto:me@alexvwan.me) with the subject
**FDO security report**. If GitHub's **Report a vulnerability** option is enabled
on this repository's Security tab, you may use that private channel instead.
Do not open a public issue or pull request containing vulnerability details,
exploit code, credentials, or private data.

Include what you can safely share:

- Affected FDO version or commit, operating system, and architecture.
- Affected component, plugin, or SDK version, where relevant.
- Reproduction steps or a minimal proof of concept using test data.
- Expected and actual behavior, potential impact, and any required permissions
  or user interaction.
- Redacted logs or screenshots and any proposed mitigation.

Never send real private keys, production tokens, credential-store contents, or
unredacted user profiles. If a report needs sensitive attachments, first ask how
to transfer them privately. Test only systems and accounts you own or have
permission to assess.

## What happens next

The maintainer will review the report, may request more information, and work
with the reporter on a fix and coordinated disclosure where appropriate.
Response and remediation times depend on severity, reproducibility, and
maintainer availability; this project does not promise a fixed response time.
If you have not heard back after a week, please follow up through the same
private channel.

Please coordinate public disclosure so users have an opportunity to update.
Let the maintainer know whether and how you would like to be credited.

## Scope

### Saved AI credentials

Saved assistant API keys and AI extension credential fields receive OS-backed
encryption in addition to the general settings format. Migration preserves
legacy data on failure, rejects plaintext storage fallbacks, and removes legacy
values only after verified encryption and an atomic settings update. Pending
migrations remain legacy-protected until the system keychain is available.
Assistant listings and broadcasts never return saved keys or their ciphertext.
See [AI credential storage and recovery](docs/AI_CREDENTIAL_STORAGE.md) for scope,
platform limitations, CLI-managed logins and backup considerations.

### Plugin trust boundary

Install plugins only from authors and repositories you trust. Plugin backends run
JavaScript in an Electron utility process with Node APIs. Capability checks on
host services and runtime API guards reduce unintended access; they are not an
OS sandbox for hostile JavaScript. A plugin signature establishes the signer and
integrity of the code, not that the code is safe.

Installed-plugin workers receive a constructed environment, rather than the
application's environment. Host API keys, cloud credentials, SSH agent sockets,
proxy credentials, and Node loader options are not inherited. Home, configuration,
cache, and temporary-directory variables point to the plugin's own data directory.

The runtime guards standard filesystem reads and module loading against a
host-supplied list: that plugin's data, signed code/assets, generated runtime, and
bundled dependency directories. Symlinks are checked against their resolved
targets. Other plugins' data and the user's configuration and credential files
are outside that list. Host-service access still requires the corresponding
capabilities and scope checks. Secrets intentionally supplied to a plugin are
accessible to that plugin and must be treated accordingly.

Known ancestor directories may be checked for existence so SDKs can create their
own directories; that does not grant listing or reading those ancestors.
Electron's ignored stdin remains available to Node, without inheriting the
application's terminal input. Unknown file descriptors are denied.

These are runtime API controls for trusted code, not containment against hostile
code or filesystem races. Broad legacy `sudo.prompt` access permits raw process
execution and can bypass in-process filesystem controls through a child process;
prefer scoped host tools. Editor-authored test commands also execute trusted
developer code and are not an isolation boundary. Strong containment of
untrusted backends requires a separate OS-enforced sandbox. Do not claim that a
zero-grant plugin is safe to run merely because these guards are present.

Reports about the FDO host, CLI, plugin isolation, capability enforcement,
privileged-action scopes, signature verification, credential handling, and
release distribution are welcome. A plugin performing an operation through an
explicitly granted permission is not by itself a permission bypass; describe
any access beyond the granted scope or misleading approval behavior.

For SDK or example-plugin issues, identify the relevant repository as well:

- [FDO SDK](https://github.com/anikitenko/fdo-sdk)
- [FDO plugins](https://github.com/anikitenko/fdo-plugins)

The same private email can be used to report issues across these projects.
For ordinary bugs and feature requests, use the
[public issue templates](https://github.com/anikitenko/fdo/issues/new/choose).
