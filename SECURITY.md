# Security Policy

DystopAI Core is a privileged, local-first operator console for OpenClaw agents. It is designed for one trusted operator boundary per machine or gateway, not hostile multi-tenant use.

## Supported Version

Security fixes are applied to the latest revision of `main`. Older builds are not guaranteed to receive backports.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability that includes exploit details, credentials, private logs, or personal data. Use GitHub's private vulnerability reporting or security advisory workflow for this repository.

Include the affected version or commit, operating system, reproduction steps, expected and observed behavior, impact, and any safe proof-of-concept material. Remove secrets, access tokens, phone numbers, email addresses, and private workspace content from evidence.

## Security Boundary

The Control Plane and OpenClaw Gateway must remain loopback-only unless the authentication, authorization, transport security, audit, and operator-identity model is redesigned for network use. Agents may receive filesystem, shell, browser, provider, or communication capabilities, so grant tools and workspaces deliberately.

Public releases must satisfy the signing and distribution-evidence requirements in `docs/RELEASE_GOVERNANCE.md`.
