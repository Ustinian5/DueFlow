# Security Policy

DueFlow is local-first and handles user-provided notices, files, schedules and optional model-provider credentials. Please do not file public issues containing private user data, API keys, local database files or sensitive diagnostics.

## Supported Versions

DueFlow is currently pre-1.0. Security fixes target the main development branch until stable release branches exist.

## Reporting A Vulnerability

If you find a vulnerability, please report it privately to the project maintainers. If a private security advisory channel is available on GitHub, use that first. Otherwise, contact the maintainers listed in the repository metadata.

Please include:

- affected version or commit;
- operating system;
- reproduction steps;
- expected and actual behavior;
- whether the issue can expose local files, API keys, Inbox content, task data, backups or diagnostics;
- any suggested fix or mitigation.

Do not include real API keys, private Inbox text, full local databases, or personal schedules in the report. Use synthetic sample data whenever possible.

## Security Boundaries

Current intended boundaries:

- Model output is not committed as tasks until the user confirms drafts.
- Desktop diagnostics omit raw Inbox text, task titles, source quotes and extracted task descriptions.
- Local pet appearances are imported from manifest-declared local assets only, reject URLs and parent traversal, and use staging for rollback.
- Local skill manifests are declarative and read-only; they are not executed as third-party code.
- Runtime secrets are read from local environment variables and `.env`, which must not be committed.

## Out Of Scope For Now

- Public multi-user hosting.
- Account authentication and authorization.
- Cloud sync.
- Automatic reading of private messaging apps.

These may become in scope if the project adds hosted or multi-device features.
