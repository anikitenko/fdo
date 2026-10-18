# Host tool setup

Settings → Tools & Prerequisites is populated from `getAllHostProcessScopePolicies()`, including host-managed shared scopes. Each executable is deduplicated across scopes and mapped to its capability IDs. This is an inventory of optional dependencies, not a list of required installations.

Detection inspects regular executable files at the same absolute locations used by the process policy. It does not execute discovered programs, probe accounts, test service health, or grant capabilities. Unreadable locations are distinguished from missing files. Tools known only to another OS remain visible when they have a guide, with an explicit notice that the host policy has no compatible executable locations. An installer alone does not amend process policy.

The UI offers guided installation: vendor setup pages and copyable platform commands where verified. Installation runs in the user's installer/terminal, not in a plugin worker or an elevated background shell. Vendor pages handle architecture, supported OS versions and Linux distribution differences. Recheck after installation; restart FDO if PATH/session changes require it. No generic package name is inferred from a capability.

## Adding a tool

1. Add its normal process capability policy and authorized executable paths to the process scope registry. Discovery needs no UI registration.
2. If the executable already has a recipe in `src/utils/system/toolInstallCatalog.js`, its guide is reused automatically by the new scope.
3. For a new executable, add one host-owned recipe keyed by executable basename (without Windows `.exe`, `.cmd` or `.bat`). Include a label, official HTTPS installation page, and optional verified commands per `darwin`, `win32`, `linux`. Linux instructions should use a vendor's distribution selector instead of assuming apt exists everywhere.
4. Add aliases (e.g. `ansible-playbook`, `ctest`) explicitly. Do not guess package identifiers or generate shell commands from plugin-supplied text. A missing recipe produces an honest fallback, not an executable installer.

The catalog currently covers cloud CLIs, Git/GitHub/GitLab, Docker/Podman, kubectl/Helm/Kustomize, Terraform/Vault/Nomad/Ansible, build tools, and common language package managers. System utilities without recipes still appear in the inventory and may be supplied by the operating system.

X11 setup is separate from X11 availability. XQuartz/xauth presence is not a reachable authenticated display, nor proof of X SECURITY isolation. Credentials & SSH → Check local X11 support performs that authenticated check. Its setup button opens this inventory. Native Windows local X11 discovery remains unsupported; installing WSLg or a Windows X server does not change the host adapter.

SSH execution is bundled in FDO and does not require installing an external SSH executable. GitOps has its separate bundled Git runtime; plugin Git process operations use the installed executable policy.
