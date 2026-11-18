#!/usr/bin/env bash
set -euo pipefail

architecture="${1:-}"
case "$architecture" in
  x64|arm64) ;;
  *) echo "Usage: $0 <x64|arm64>" >&2; exit 2 ;;
esac

log_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
build_log="$log_dir/automnia-macos-${architecture}-build.log"
retry_log="$log_dir/automnia-macos-${architecture}-dmg-retry.log"

set +e
npm run dist:mac -- "--$architecture" 2>&1 | tee "$build_log"
build_status=${PIPESTATUS[0]}
set -e

if [ "$build_status" -eq 0 ]; then
  exit 0
fi

if ! grep -Fq "Unable to detach device cleanly: hdiutil: couldn't eject" "$build_log" \
  || ! grep -Fq 'Resource busy' "$build_log"; then
  exit "$build_status"
fi

echo "[macos-release] retrying only the $architecture DMG after transient hdiutil eject contention"
python3 - "${TMPDIR:-/tmp}" "${RUNNER_TEMP:-/tmp}" <<'PY'
import os
import plistlib
import re
import subprocess
import sys

temporary_roots = [os.path.realpath(value) for value in sys.argv[1:] if value]
info = subprocess.run(
    ["hdiutil", "info", "-plist"],
    check=True,
    stdout=subprocess.PIPE,
)
images = plistlib.loads(info.stdout).get("images", [])
detached = []
errors = []

for image in images:
    image_path = os.path.realpath(image.get("image-path", ""))
    if not image_path or not any(
        os.path.commonpath([image_path, root]) == root
        for root in temporary_roots
    ):
        continue

    devices = [
        entity.get("dev-entry", "")
        for entity in image.get("system-entities", [])
        if entity.get("dev-entry")
    ]
    device = next(
        (value for value in devices if re.fullmatch(r"/dev/disk\d+", value)),
        devices[0] if devices else "",
    )
    if not device:
        continue

    result = subprocess.run(
        ["hdiutil", "detach", device, "-force", "-quiet"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if result.returncode == 0:
        print(f"[macos-release] detached failed temporary DMG image {device}")
        detached.append(device)
    else:
        message = result.stdout.strip() or f"hdiutil detach exited {result.returncode}"
        errors.append(f"{device}: {message}")

if errors:
    raise SystemExit("Could not clear failed temporary DMG mounts: " + "; ".join(errors))
if not detached:
    print("[macos-release] no temporary DMG mounts remained to detach")
PY
sleep 5

set +e
npm run dist:mac -- "--$architecture" dmg 2>&1 | tee "$retry_log"
retry_status=${PIPESTATUS[0]}
set -e

exit "$retry_status"
