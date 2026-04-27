# soohan-skills

Personal Claude Code plugin marketplace. The repo's `plugins/` directory is the source of truth; `.claude-plugin/marketplace.json` is generated from it.

## Quick commands

```
pnpm sync       # regenerate .claude-plugin/marketplace.json from plugins/
pnpm validate   # check every plugin.json against the schema (no writes)
pnpm test       # run Vitest suite (36 tests)
```

`pnpm` is **not on the default PATH** in this environment. If `pnpm` errors with command-not-found, prefix with:

```
PATH="$HOME/.nvm/versions/node/v24.14.0/lib/node_modules/corepack/shims:$PATH"
```

For coverage runs the RTK proxy needs to be bypassed: `rtk proxy pnpm exec vitest run --coverage`.

## Architecture

Three scripts in `scripts/`, all imported as ESM, run via `tsx` (no build step):

- `schema.ts` — Zod `PluginManifestSchema`. **Single source of truth** for what a `plugin.json` may contain. Both `sync.ts` and `validate.ts` import from here.
- `sync.ts` — pure `syncMarketplace(root)` function + thin `isMain()` CLI wrapper. Walks `plugins/*/`, validates, sorts by name, writes `marketplace.json`.
- `validate.ts` — non-mutating sibling. Returns `ValidationError[]`. Same checks as sync (schema, dir/name match, duplicate names) but never writes.

CLI dispatch blocks (`if (isMain()) { ... }`) are wrapped in `/* v8 ignore start/stop */` so the 80% coverage threshold targets only the testable function bodies.

## Plugin authoring rules

```
plugins/<plugin-name>/
├── .claude-plugin/plugin.json     # required; metadata
├── skills/<skill-name>/SKILL.md   # optional; one subdir per skill
├── commands/<command-name>.md     # optional; one file per slash command
├── agents/                        # optional
└── README.md
```

**Conventions enforced by the schema and sync:**

- Plugin directory name **must** equal `name` field in `plugin.json` (kebab-case).
- `category` and every entry in `tags` must be kebab-case.
- `version` must be semver (pre-release suffixes allowed).
- Two plugins cannot share a `name`.

**Naming gotchas — avoid plugin name = inner element name:**

Claude Code namespaces skills as `<plugin>:<skill>` and commands as `<plugin>:<command>`. If the inner names match the plugin name, the listing reads e.g. `dry-skill:dry-skill` — ugly. **Use distinct inner names.** Convention in this repo: short verb names like `run`, `diff`, `trace`, `explain`. Example:

- ❌ `plugins/dry-skill/skills/SKILL.md` with `name: dry-skill` → listed as `dry-skill:dry-skill`
- ✅ `plugins/dry-skill/skills/run/SKILL.md` with `name: run` → listed as `dry-skill:run`

The same applies to `commands/`: prefer `commands/run.md` (listed as `dry-skill:run`, invoked as `/run` or `/dry-skill:run`) over `commands/dry-skill.md`.

## Generated files — do not hand-edit

- `.claude-plugin/marketplace.json` — regenerated on every commit by the Husky pre-commit hook (`pnpm sync && git add .claude-plugin/marketplace.json`). Hand edits will be silently overwritten. CI on main also fails on drift via `git diff --exit-code`.
- `pnpm-lock.yaml` — pnpm-managed; commit but don't hand-edit.

## Testing rules

- **TDD only** for `scripts/*.ts` (per global coding-style rules). Tests live in `tests/<name>.test.ts`, one per script.
- **Coverage gate**: ≥80% lines/branches/functions/statements. Configured in `vitest.config.ts`. Adding a new script means adding tests that satisfy the gate.
- Tests use `mkdtempSync(tmpdir() + ...)` fixtures and `rmSync` in `afterEach`. **Never touch the real `plugins/` directory** from a test — it would interfere with the running marketplace.
- Behavior-focused asserts only (read back the written file, check the returned errors). No mocking of `fs` — use real tmpdir I/O.

## Workflow

1. Add or modify files under `plugins/<name>/`.
2. `git commit` — the pre-commit hook runs `pnpm sync` + auto-stages `marketplace.json`. If schema validation fails, the commit is blocked.
3. Push to `main` → GitHub Actions `verify` workflow re-runs sync, asserts no drift, runs tests.
4. CI **does not run on PRs** (single-maintainer convention). The drift check fires only on push to `main`.

## End-user install / update flow (for plugin consumers)

```
# First time
/plugin marketplace add soohanpark/soohan-skills
/plugin install <name>@soohan-skills
/reload-plugins

# After plugin changes
/plugin marketplace update soohan-skills
/plugin uninstall <name>@soohan-skills
/plugin install <name>@soohan-skills
/reload-plugins
```

`marketplace update` only refreshes the catalog. To pick up changed SKILL/command files in an already-installed plugin, the uninstall → install → reload cycle is required.

## Spec & plan

The original design and implementation plan live under `docs/superpowers/`:

- `docs/superpowers/specs/2026-04-27-skill-marketplace-design.md`
- `docs/superpowers/plans/2026-04-27-skill-marketplace.md`

When extending the marketplace, prefer updating the spec first (the design rationale lives there) and adding a follow-up plan if the change is non-trivial.
