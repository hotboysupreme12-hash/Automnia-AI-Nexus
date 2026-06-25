# DystopAI Signed Windows Release Runbook

This runbook qualifies a public Windows build without allowing CI to publish or modify a GitHub Release automatically.

## 1. Prepare the release revision

1. Update `package.json` version and `CHANGELOG.md`.
2. Confirm `package-lock.json` is current.
3. Run `npm ci`, `npm run audit:dependencies`, and `npm run verify:release-candidate` on a clean checkout.
4. Stop DystopAI and create a state backup before testing an upgrade on an operator machine.
5. Merge only after Windows, Ubuntu, and macOS quality checks pass.
6. Create a signed tag matching the package version, such as `v0.0.6`.

## 2. Configure release credentials

Configure these GitHub Actions secrets:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- `DYSTOPAI_RELEASE_SIGNING_PRIVATE_KEY_PEM`
- `DYSTOPAI_UPDATE_SIGNING_PRIVATE_KEY_PEM`

For macOS qualification, also configure `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Optionally set `DYSTOPAI_RELEASE_SIGNING_KEY_ID` and `DYSTOPAI_UPDATE_SIGNING_KEY_ID`. Keep certificates and Ed25519 private keys outside the repository.

## 3. Run qualification

Push the signed `v*` tag or manually run **Public Release Candidate**. The run must finish with every step green. Configure `DYSTOPAI_PREVIOUS_WINDOWS_INSTALLER_PATH` only when the runner already has a trusted previous installer available. The first signed release may use the same-version repair path; later releases should supply a downloaded, signature-verified previous installer before claiming upgrade coverage.

## 4. Inspect the artifact

Download the workflow artifact and verify it contains:

- the Authenticode-signed NSIS installer;
- `dystopai-sbom.cdx.json`;
- `checksums.sha256` and `checksums.sha256.sig`;
- both signing public keys;
- `release-signing.json`;
- `distribution-signing.json`;
- Authenticode and installer lifecycle evidence;
- signed update manifest, signature, and verification summary;
- lifecycle logs.

Run `npm run release:validate` against the extracted artifact with `DYSTOPAI_RELEASE_REQUIRE_SIGNING=1` before publication.

## 5. Publish without changing bytes

Create the GitHub Release manually from the same signed tag. Upload the exact qualified files without rebuilding or renaming the installer:

- installer;
- `update-manifest.json`;
- `update-manifest.json.sig`;
- `update-manifest-public-key.pem`;
- checksum and signature files;
- SBOM and release evidence bundle.

The installer bytes uploaded to the release must match the exact size and SHA-256 digest recorded in `update-manifest.json`. Any byte change requires a new qualification run.

## 6. Post-publication verification

From a clean Windows account or virtual machine:

1. Download the installer through the published HTTPS URL.
2. Verify Authenticode and the SHA-256 checksum.
3. Verify the update-manifest Ed25519 signature.
4. Perform a fresh install and launch.
5. Confirm uninstall behavior.
6. On later releases, upgrade from the previous public release and execute rollback evidence again.
7. Archive the release SHA, workflow URL, artifact digest, and evidence with the release notes.

## Stop conditions

Do not publish when signing or timestamp validation is missing, a quality gate failed, the package version and tag differ, the update URL is incorrect, lifecycle logs are missing, checksums changed, or private key material appears anywhere in the artifact.
