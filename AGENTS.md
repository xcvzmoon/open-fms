<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

<!--NITRO START-->

This project is based on [Nitro v3](https://nitro.build), [h3](https://h3.dev/), and [Rolldown](https://rolldown.rs/).

Refer to `node_modules/nitro/dist/docs/README.md` when working on server (your knowledge about Nitro v3 is likely outdated!).

## Project Structure

`server/` contains server-side code with supported subdirs (create as needed): `api/` (/api prefixed handlers), `routes/` (non-prefixed route handlers), `middleware/`, `plugins/`, `utils/`, `assets/`, and `tasks/`. `public/` holds static assets (copied, not bundled). Config files: `nitro.config.ts` (serverDir, routeRules, preset, etc.), `tsconfig.json`.

## Conventions

- Path alias `~/*` (tsconfig), use explicit `.ts` extensions

<!--NITRO END-->

## Stack

- Monorepo workspaces: `apps/*`, `packages/*`, `tools/*`
- `apps/web`: Nuxt **4** (stable `nuxt@^4.5.2`), Vue 3, Vue Router 5, TypeScript **6** (pinned for golar/oxlint — do not bump manually)
- `apps/api`: Nitro v3 + h3 + Rolldown
- Toolchain: **Vite+** (`vp` / `vp run`). Underlying package manager is recorded in `package.json` `devEngines` (do not invoke it directly).
- Lint/format: **oxlint + oxfmt** via Vite+ (`vite.config.ts` is the source of truth). Type-aware lint is on. Not ESLint/Prettier.

Run `vp install` before the first typecheck.

**Verification order:** `vp run check` → `vp run typecheck` → `vp run test` → `vp run build`. Run that sequence before calling work done.

Do not treat `tools/oxlint/anti-slop/**` or `.agents/**` as something to refactor for product features. oxfmt/oxlint intentionally ignore both.

## Git Hooks

Vite+ git hooks replace lefthook. Dispatcher is installed via `prepare` → `vp config` / `vp hooks enable`.

- **pre-commit** (`.vite-hooks/pre-commit`): unstages force-added gitignored files, runs `vp staged` (`staged` rules in `vite.config.ts`), then re-adds those files with `git add -f`. Gitignored staged files are intentionally not format/linted by the hook.
- **pre-push** (`.vite-hooks/pre-push`): `vp run check` → `vp run typecheck` → `vp run test`

Check status with `vp hooks status`. Per-commit skip: `VP_GIT_HOOKS=0 git commit`. Do not bypass with `--no-verify`.

## Style And Type Rules

oxfmt: single quotes; import order is type-imports → builtins/externals → internal → relative.

oxlint is type-aware (`typeAware` / `typeCheck`) and includes the local **anti-slop** plugin. Failures here are common when writing "helpful" generic helpers:

- No `as` / type assertions without a preceding `SAFETY:` comment (const assertions are fine).
- No broad `object` / `unknown` as parameter, return, or type-alias types. Use named types; parse external input at the boundary. (Prefer `unknown` over `any` only for values you will narrow — not as a bare function input type.)
- No `filter().map()` chains — use one loop. No `reduce` that just copies into a new object/array.
- No bag options / object parameters when discrete arguments fit.
- No `Reflect.apply`, `Reflect.get`, runtime `typeof` for type-level decisions, or chained assertions.
- No module mocking in tests (`anti-slop/no-module-mocking`).
- No accumulating array/object spread in loops (`oxc/no-accumulating-spread`).
- `no-console`: only `warn` / `error` / `info`.
- Unused vars/args: prefix with `_`.
- `no-non-null-assertion` is a warning — avoid `!`.

Vue: Composition API + `<script setup>` is the project direction (see `.agents/skills/vue-*` when loaded).

## Code conventions

- Use `import type` for type-only imports (enforced by oxlint's `typescript/consistent-type-imports`)
- **Single quotes**, no semicolons
- **`no-console`**: only `warn`/`error`/`info` allowed
- **`no-non-null-assertion`** is a warning — avoid `!`; type-aware rules also catch most unsafe patterns

## Editing Guidance

- Make the smallest correct change.
- Do not polish unrelated code.
- Do not remove correct comments or documentation.
- Do not rename broad parts of the codebase unless required.
- Do not expand a change into a repo-wide refactor unless necessary.
- Prefer leaving correct existing code in place.
- When touching production-sensitive code, prioritize reliability over clever abstractions.

## Formatting And Style

- Match the surrounding file's formatting instead of hand-styling custom layouts.
- Prefer `function name()` for named functions and helpers.
- Do not prefer `const fn = () => {}` for normal top-level helpers.
- Exception: callbacks should stay as arrows, for example `items.map((item) => item.id)`.
- If only one or two properties is needed from iterated item and will not conflict other variables, prefer destructuring.
- Prefer functions over classes.
- Existing classes that are already correct can stay; do not rewrite them for style only.
- Keep diffs small and focused.

## Types And Naming

- Prefer `type` over `interface`.
- Avoid `any`; prefer `unknown` and narrow it explicitly but avoid creating isRecord function.
- Add explicit return types to exported functions and non-trivial helpers.
- Use string literal unions for small state enums like `'ok' | 'error'`.
- Keep generics minimal and purposeful.
- Reuse existing helper types before inventing new ones.
- Use descriptive names.
- Do not abbreviate iterable items; prefer `item`, `entry`, `record`, `status`.
- Avoid one-letter names except for conventional indexes.

## Validation, Errors, And Responses

- Use Valibot for environment parsing, form validation, and request validation.
- Prefer `camelCaseSchema` over `PascalCaseSchema` in generating schemas.
- Prefer composable `v.pipe()` schemas with built-in actions and reusable transform helpers instead of manual parsing or ad-hoc validation logic.
- Validate once at the boundary, not repeatedly in inner layers.
- Never throw raw strings.
- Catch infrastructure errors where graceful degradation is expected.
- Clean up temporary resources in `finally` blocks.
- Include stable error codes in config validation and app-level failures.

## Skills

Project skills live in `.agents/skills/` and are tracked in `skills-lock.json`. They are vendored agent instructions, not product code. Use relevant skills when loaded (for example `/unslop`, `/vue-best-practices`, `/nitro`, `/valibot`). Do not rewrite skill folders as part of product features.

## Agents

- Disable co-author and never commit nor push.
- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
- If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong so fix the code.
- Always use the unslop skill `/unslop` when generating texts as well as in adding jsdocs/tsdocs or just comments.
