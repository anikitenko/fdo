#!/usr/bin/env bash
set -euo pipefail

# Use an isolated Secret Service session rather than Chromium's basic_text fallback.
if [[ "${FDO_CI_KEYRING_SESSION:-}" != "1" ]]; then
    exec dbus-run-session -- env FDO_CI_KEYRING_SESSION=1 bash "$0" "$@"
fi

ci_keyring_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/fdo-ci-keyring.XXXXXX")"
export XDG_DATA_HOME="$ci_keyring_dir/data"
export GNOME_KEYRING_CONTROL="$ci_keyring_dir/control"
export XDG_CURRENT_DESKTOP=GNOME
mkdir -p "$XDG_DATA_HOME" "$GNOME_KEYRING_CONTROL"
chmod 700 "$ci_keyring_dir" "$XDG_DATA_HOME" "$GNOME_KEYRING_CONTROL"

ci_keyring_password="$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
printf '%s' "$ci_keyring_password" | gnome-keyring-daemon --foreground --unlock --components=secrets \
    --control-directory="$GNOME_KEYRING_CONTROL" >"$ci_keyring_dir/daemon.log" 2>&1 &
ci_keyring_pid=$!
unset ci_keyring_password

cleanup() {
    kill "$ci_keyring_pid" 2>/dev/null || true
    wait "$ci_keyring_pid" 2>/dev/null || true
    rm -rf "$ci_keyring_dir"
}
trap cleanup EXIT

if ! gdbus wait --session --timeout=15 org.freedesktop.secrets; then
    cat "$ci_keyring_dir/daemon.log" >&2
    exit 1
fi
# Fail before launching the suite if the keyring is locked or cannot persist a secret.
printf '%s' 'fdo-keyring-ready' | timeout 15s secret-tool store --label='FDO CI keyring check' fdo-ci readiness
[[ "$(timeout 15s secret-tool lookup fdo-ci readiness)" == 'fdo-keyring-ready' ]]

xvfb-run -a bash -e -c '
    # Check the actual Playwright launch path, including its Electron loader.
    node scripts/check-ci-keyring.cjs
    exec "$@"
' bash "$@"
