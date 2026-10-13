# Security policy

Agentbits gives AI agents real capabilities (editing files, running commands, reaching servers, databases and
connected apps), so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub:
**[Report a vulnerability](https://github.com/godilman/agentbits/security/advisories/new)**
(repository → *Security* → *Report a vulnerability*).

Please include:

- the Agentbits version (Settings → General shows `Agentbits v<version>`) and your operating system;
- the provider involved (Claude Code CLI, Codex CLI, Anthropic API, OpenAI API or Demo), if any;
- steps to reproduce, what you expected and what happened;
- the impact as you see it (for example: an agent exceeding its permissions, a secret leaving the main process, a
  bypass of the approval or audit flow).

Please don't include real API keys, passwords or personal data in the report.

## What to expect

This is a one-person project, so response times are best effort. I aim to acknowledge reports within a week and to
keep you informed until a fix or a decision is published. With your permission, you will be credited in the release
notes.

## Supported versions

Only the latest released version (and the `main` branch) receives security fixes.

## Scope

In scope: anything that lets an agent, a file, a query result, a connected app (MCP server) or a web page do more
than the permissions the user granted, read secrets, skip approvals, or avoid the audit log.

Known and documented boundaries are listed in [docs/SECURITY.md](docs/SECURITY.md) (in Turkish). For example, an
agent that you give terminal and network permissions can act with your OS user's rights. Reports that show those
boundaries are weaker than documented are welcome.
