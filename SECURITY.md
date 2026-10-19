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
