#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import lzma
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DELTA_PATH = ROOT / ".production-readiness" / "apply-delta.b64"
EXPECTED_COMPRESSED_SHA = "4a232cb2627c85adb3c9b368bcb59def654f2c0522e4972607455d5691a55c58"


def safe_repo_path(value: str) -> Path:
    candidate = (ROOT / value).resolve()
    if candidate != ROOT and ROOT not in candidate.parents:
        raise RuntimeError(f"unsafe delta path: {value}")
    return candidate


encoded = DELTA_PATH.read_text(encoding="ascii").strip()
compressed = base64.b64decode(encoded, validate=True)
if hashlib.sha256(compressed).hexdigest() != EXPECTED_COMPRESSED_SHA:
    raise RuntimeError("production readiness delta checksum mismatch")

manifest = json.loads(lzma.decompress(compressed))
if manifest.get("version") != 1:
    raise RuntimeError("unsupported delta version")

source_paths = {
    operation[1]
    for item in manifest["files"]
    for operation in item["ops"]
    if operation[0] == "c"
}
source_lines = {
    relative_path: safe_repo_path(relative_path)
    .read_text(encoding="utf-8")
    .splitlines(keepends=True)
    for relative_path in source_paths
}

outputs: dict[str, str] = {}
for item in manifest["files"]:
    relative_path = item["path"]
    chunks: list[str] = []
    for operation in item["ops"]:
        if operation[0] == "d":
            chunks.append(operation[1])
        elif operation[0] == "c":
            _, source_path, start, count = operation
            chunks.extend(source_lines[source_path][start : start + count])
        else:
            raise RuntimeError(f"unknown delta operation: {operation[0]}")

    text = "".join(chunks)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if digest != item["sha256"]:
        raise RuntimeError(f"reconstructed hash mismatch for {relative_path}")
    outputs[relative_path] = text

for relative_path, text in outputs.items():
    target = safe_repo_path(relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.production-ready.tmp")
    with temporary.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    os.replace(temporary, target)

print(f"Applied verified production readiness delta to {len(outputs)} files.")
