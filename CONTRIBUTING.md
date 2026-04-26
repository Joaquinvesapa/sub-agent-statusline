# Contributing

Thanks for your interest in contributing to `opencode-subagent-statusline` ❤️

We aim to keep contributions simple, respectful, and easy to review.

## Before You Start

- Please check existing issues/PRs to avoid duplicate work.
- Prefer an issue-first workflow for non-trivial changes (bugfixes/features).
- For tiny docs fixes, feel free to open a PR directly.

## Local Setup

### Requirements

- Node.js 20+
- pnpm 9+

### Install

```sh
pnpm install
```

## Development Flow

1. Fork the repository
2. Create a branch from `main`
3. Make your changes in small, reviewable commits
4. Open a pull request with context and rationale

Branch naming suggestions:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`

## Commit Messages

Use **Conventional Commits**:

- `feat: add runtime summary grouping`
- `fix: handle missing token metadata`
- `docs: clarify local setup`

## Quality Checks

Run what exists in this repository before opening a PR:

```sh
pnpm typecheck
```

If additional test scripts are introduced, please run them as well.

## Security & Secrets

- Never commit secrets, tokens, API keys, or private credentials.
- If your change touches security-sensitive behavior, mention it clearly in the PR.
- For vulnerabilities, follow [SECURITY.md](./SECURITY.md).

## Pull Requests

Please include:

- what changed
- why it changed
- how you validated it locally
- screenshots/log snippets when UI or behavior changes are involved

Keep PRs focused. Smaller PRs get reviewed faster and with better feedback.

## Code of Conduct

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
