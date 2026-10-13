# Contributing to Agentbits

Thank you for your interest! Bug reports, ideas, translations and careful testing help the most.

## Issues first

- **Bugs:** open an [issue](https://github.com/godilman/agentbits/issues) with your OS, Agentbits version
  (Settings → General), the provider you used and the steps to reproduce. Screenshots help, but please remove API
  keys, paths and personal data from them first.
- **Ideas:** describe the problem you want to solve before the solution. Check
  [docs/FEATURES.md](docs/FEATURES.md) for what exists and what is planned.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).

## About the license and pull requests

Agentbits is source-available under the [PolyForm Strict License 1.0.0](LICENSE), which does not allow changes or
derivative works. To make contributions possible anyway:

- **Permission to prepare contributions.** As the licensor, I give you permission to modify Agentbits only to prepare
  a contribution (a pull request or a patch) to this repository, and to use that modified copy privately to test it.
  This permission doesn't cover distributing the modified version or using it for anything else.
- **Your contribution.** By submitting a pull request, you confirm that you wrote it (or have the right to submit it).
  You also agree that it may be included in Agentbits and used, changed and distributed as part of the project, under
  the project's current license or any future one.

Please **open an issue before a larger pull request**, so we can agree on the approach first.

## Development setup

Requirements: Node.js 22+. Windows, macOS or Linux.

```bash
git clone https://github.com/godilman/agentbits.git
cd agentbits
npm ci
npm run dev
```

Use a separate data folder and the Demo provider for testing, so your own data stays untouched:

```bash
AGENTBITS_DATA_DIR=/tmp/agentbits-test npm run dev
```

Never point a project folder at the Agentbits repository itself (the app refuses it): agents really change files.

## Before you open a pull request

```bash
npm run typecheck
npm run test:unit
npm run build
```

All three must pass (CI runs them on Windows and Linux). In addition:

- **No hard-coded UI text.** Every string the user sees goes into `src/shared/locales/en/` **and** `tr/`;
  `npm run test:unit` checks this. See [docs/I18N.md](docs/I18N.md).
- **Security promises are enforced in code, not in prompts.** If you change permissions, connections, files, apps or
  approvals, add a negative test under `tests/`.
- **Secrets never leave the main process.** No keys, passwords or tokens in the renderer, prompts, logs or terminals.
- **Migrations are append-only** (`src/main/db/schema.ts`). Never edit an applied migration.
- **Keep the docs current:** `docs/FEATURES.md` and `docs/CHANGELOG.md` for every change, plus `ARCHITECTURE.md`,
  `DATABASE.md` or `DECISIONS.md` when relevant.

The full list of rules and pitfalls (written for coding agents, useful for humans too) is in
[CLAUDE.md](CLAUDE.md). The developer documentation in `docs/` is in Turkish; issues and pull requests in English
or Turkish are both fine.

## Translations

The UI is available in English and Turkish. Adding a language means adding a folder under `src/shared/locales/` and a
line in `LANGUAGES`; the steps are in [docs/I18N.md](docs/I18N.md).
