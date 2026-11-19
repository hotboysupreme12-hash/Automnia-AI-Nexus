#!/usr/bin/env bash
set -euo pipefail

architecture="${1:?usage: smoke-macos-release-zip.sh <x64|arm64>}"
case "$architecture" in
  x64) expected_arch="x86_64" ;;
  arm64) expected_arch="arm64" ;;
  *) echo "Unsupported macOS release architecture: $architecture" >&2; exit 2 ;;
esac

zip_path="$(find release -type f -name "*-$architecture.zip" -print -quit)"
test -n "$zip_path" && test -f "$zip_path"
unzip -tq "$zip_path"

extract_root="$(mktemp -d "$RUNNER_TEMP/automnia-mac-zip-$architecture.XXXXXX")"
trap 'rm -rf "$extract_root"' EXIT
ditto -x -k "$zip_path" "$extract_root"

app_path="$(find "$extract_root" -type d -name 'Automnia AI Nexus.app' -print -quit)"
test -n "$app_path" && test -d "$app_path"
executable="$app_path/Contents/MacOS/Automnia AI Nexus"
test -f "$executable"
actual_arch="$(lipo -archs "$executable")"
test "$actual_arch" = "$expected_arch"
minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app_path/Contents/Info.plist")"
[[ "$minimum_os" == "13.5.0" ]]

AUTOMNIA_PACKAGED_MAC_APP_PATH="$app_path" npm run smoke:packaged-electron-launch
