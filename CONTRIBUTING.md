# Contributing to Buildr

Thanks for taking the time to contribute. This document covers how to set up the project, the standards we hold changes to, and how a pull request gets from open to merged.

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to Contribute

- **Bug reports**: open an [issue](https://github.com/xcvzmoon/buildr/issues/new/choose) using the bug report template.
- **Feature requests**: open an issue using the feature request template, or start a [discussion](https://github.com/xcvzmoon/buildr/discussions) if the idea isn't concrete yet.
- **Security vulnerabilities**: do not open a public issue. Follow [`SECURITY.md`](./SECURITY.md) instead.
- **Code and documentation**: pull requests are welcome. For anything larger than a small fix, open an issue first so we can align on direction before you invest the time.

## Development Setup

Buildr is a pnpm workspace managed through [Vite+](https://viteplus.dev) (`vp`). Check `devEngines`/`engines` in `package.json` for the required pnpm and Node versions.

```bash
vp install
```

`packages/database` needs its own `.env` (copy `packages/database/.env.example`) pointing at a Postgres database via `DB_URL`. Other workspaces will grow their own `.env.example` as they pick up configuration.

Read the [README](../README.md) for the commands used to run and build each workspace.

## Coding Standards

The full set of conventions this project enforces lives in [`AGENTS.md`](../AGENTS.md) (symlinked as `CLAUDE.md`). The short version:

- TypeScript strict mode, explicit `.ts` extensions in imports, no `any`, no non-null assertions (`!`).
- Prefer `function name()` over `const name = () => {}` for top-level helpers; arrow functions stay for callbacks.
- Prefer `type` over `interface`, and Valibot (`v.pipe()`) for parsing and validation at the boundary rather than ad-hoc checks.
- Make the smallest correct change. Don't refactor unrelated code, don't add speculative abstractions, and don't leave a change half-finished.

Formatting and linting are automated, not a matter of taste:

```bash
vp check        # fmt + lint + typecheck
vp check --fix  # same, but auto-fixes what it can
```

Vite+'s Git hook dispatcher runs `vp check --fix` against staged files on commit (see the `staged` config in `vite.config.ts`), so most formatting and lint issues are caught before they leave your machine.

## Testing

```bash
vp test          # vitest, once
vp test watch    # vitest, watch mode
```

`vp check` includes a type check across every workspace. Add or update tests for any behavior change, colocated with the code they cover or under a `tests/` directory that mirrors the source layout, matching whatever convention already exists in the workspace you're touching.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat: add project switcher
fix: handle empty test results
chore(ci): bump action versions
docs: update deployment guide
```

This applies to your PR title in particular. Individual commits within a PR don't need to be squeaky clean, since we squash on merge, but the PR title becomes the commit message that ships to `main`.

## Pull Request Process

1. Fork the repository (or branch directly, if you have write access) and make your change.
2. Run `vp check` and `vp test` locally. Both must pass before CI will pass.
3. Open a pull request against `main`. The template will prompt you for a description, related issues, and a testing summary.
4. CI runs format/lint/typecheck and the test suite; both must pass.
5. A maintainer will review your PR.
6. Once approved and green, a maintainer merges. We use squash merges, so keep your PR title accurate: it becomes the commit message.

## License

By contributing, you agree that your contributions will be licensed under the project's [MIT License](../LICENSE).
