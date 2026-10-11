# Security

Report a vulnerability through this repository's GitHub private vulnerability reporting when enabled. Keep credentials and personal data out of public issues and pull requests.

Actual configuration belongs in ignored local environment files or the hosting provider's secret settings. Templates contain placeholders. Source changes run a checksum-verified Gitleaks scan. These checks reduce accidental exposure; they do not certify that future changes are secure.

## Setup and deployment

Apply all migrations to your own database before starting the application. Migrations 014 and 015 provide the atomic quote operation, shared request budgets and ordered billing updates required by this source. The public repository has no hosted database or deployed environment attached.

At publication review, the runtime npm audit reported zero findings. Five high-severity entries remain in development lint dependencies (Next ESLint / fast-glob / micromatch / braces), with no patched braces release reported. Run lint only against trusted source while awaiting the upstream fix. Do not downgrade the application framework to satisfy a forced audit fix.

Validation: 384 unit tests, type-check, lint, production build, isolated PostgreSQL migration/concurrency/rollback/permission tests, and public-page browser checks with synthetic configuration. Authenticated Auth0 end-to-end tests require dedicated private CI credentials and were not run locally.
