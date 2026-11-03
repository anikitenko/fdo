# AI credential storage

FDO protects saved assistant API keys with Electron `safeStorage` and the existing
OS credential-session helper. The encryption key comes from the system credential
store; the general settings password `FDO-APPLICATION` is not sufficient to
decrypt these fields.

The same layer protects MCP bearer tokens, custom header and environment values,
MCP OAuth state (including refresh tokens and client secrets), and Codex hook
environment values. Non-secret configuration stays in the existing settings
format. Do not embed secrets in skill text, commands, arguments or endpoint URLs;
those are configuration, not credential fields.

## Migration and recovery

After Electron is ready, FDO automatically stages migration of legacy AI secrets.
Each value is encrypted and round-trip verified before one atomic settings write
replaces the legacy values. A failed keychain operation, encryption check or
settings write leaves the existing credentials available for a later retry.
Provider use does not fall back to the legacy plaintext value when OS protection
is unavailable.

If migration is paused, Settings → AI Assistants shows the pending state. Unlock
or configure the system keychain and choose **Retry credential migration**.
Existing keys remain in the legacy settings until a successful migration; FDO
does not claim that pending legacy values already have OS protection. Newly
entered secrets cannot be saved without OS protection. Keyless/local assistants
do not require keychain access for provider selection.

Saved assistant listings and change broadcasts contain an empty `apiKey` field
and `hasApiKey` metadata. They contain neither the key nor its ciphertext. Only
the selected assistant's credential is decrypted for a main-process provider
request. Plugin host-AI requests receive an actionable error if the credential
store is unavailable; they never receive the key.

## Platform and backup limits

- macOS uses the application Keychain protection and the existing retryable
  credential-session helper. A consistent application signature is important
  when using the real Keychain across releases.
- Windows uses the OS account's DPAPI protection. This is not a boundary against
  other programs already running as that Windows user.
- Linux requires GNOME Secret Service or a supported KWallet backend. FDO refuses
  `basic_text`, unknown and unavailable backends; there is no plaintext fallback.

Copying an FDO settings file to a different machine/account may require entering
credentials again. Older FDO versions cannot use the migrated credential format;
keep the updated version when using these settings. Never replace an unreadable encrypted key with an empty value
automatically. CLI-managed Codex/Gemini sign-in files remain owned by those CLIs;
this migration does not move or delete their login files.

Migration replaces the active settings values. It cannot erase older backups,
filesystem snapshots, logs made by older versions, or copied settings files.
Rotate provider credentials if earlier copies may have been exposed. Secrets
remain in main-process memory while used and are sent to their intended provider.
This protection does not turn local plugins or the AI runtime into an OS sandbox.

## Implementation and regression coverage

- `src/utils/persistence/aiCredentialSettings.cjs`: protected reads/writes,
  migration, selected-assistant hydration and public metadata.
- `src/utils/persistence/aiCredentialProtection.js`: OS-provider policy, including
  Linux fallback rejection.
- `tests/unit/ai-credential-settings.test.js` and
  `tests/unit/ai-credential-protection.test.js`: migration, failure preservation,
  malformed ciphertext, prefix/envelope spoofing, metadata-only updates, and
  unavailable/weak OS providers.
- `tests/e2e/ai-credential-storage.spec.js`: real Electron storage, decrypting the
  settings with the old fixed key, locked-store failure and UI recovery,
  automatic migration, redacted IPC, and restart decryption. Tests use synthetic
  keys and disposable profiles; macOS automation uses the mock Keychain.

The packaged-host CI runner includes this regression on macOS, Windows and Linux.
See [Electron's storage semantics](https://www.electronjs.org/docs/latest/api/safe-storage)
and the [plugin trust boundary](../SECURITY.md#plugin-trust-boundary).
