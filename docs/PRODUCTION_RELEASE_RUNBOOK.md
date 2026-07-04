# Automnia AI Signed Windows Release Runbook

This runbook qualifies a public Windows build without allowing CI to publish or modify a GitHub Release automatically.

## 1. Prepare the release revision

1. Update `package.json` version and `CHANGELOG.md`.
2. Confirm `package-lock.json` is current.
3. Run the release-candidate verification path on a clean checkout.
4. Stop Automnia AI and create a state backup before testing an upgrade on an operator machine.
5. Merge only after Windows, Ubuntu, and macOS quality checks pass.
6. Create a signed tag matching the package version.

## 2. Configure release credentials

Configure platform signing and release-evidence signing through GitHub Actions settings. Keep certificates and signing key material outside the repository.

## 3. Run qualification

Push the signed version tag or manually run **Public Release Candidate**. The run must finish with every step green.

## 4. Inspect the artifact

Download the workflow artifact and verify it contains:

- the signed Windows installer;
- SBOM and checksum evidence;
- release evidence summary;
- distribution evidence;
- update manifest evidence;
- lifecycle logs.

Run release validation against the extracted artifact before publication.

## 5. Publish without changing bytes

Create the GitHub Release manually from the same signed tag. Upload the exact qualified files without rebuilding or renaming the installer. The installer bytes uploaded to the release must match the size and checksum recorded in release evidence. Any byte change requires a new qualification run.

## 6. Post-publication verification

From a clean Windows account or virtual machine:

1. Download the installer through the published HTTPS URL.
2. Verify installer signing and checksum evidence.
3. Verify the update manifest evidence.
4. Perform a fresh install and launch.
5. Confirm uninstall behavior.
6. On later releases, upgrade from the previous public release and execute rollback evidence again.
7. Archive the release SHA, workflow URL, artifact digest, and evidence with the release notes.

## Stop conditions

Do not publish when signing or timestamp validation is missing, a quality gate failed, the package version and tag differ, the update URL is incorrect, lifecycle logs are missing, checksums changed, or release key material appears anywhere in the artifact.
