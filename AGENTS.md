# soohan-skills

Personal skill/plugin marketplace. The repo's `plugins/` directory is the source of truth; `.claude-plugin/marketplace.json` is generated from it.

`AGENTS.md` (this file) is the canonical instruction file; `CLAUDE.md` and `GEMINI.md` are one-line `@AGENTS.md` imports. Edit this file, never the pointers.

## Multi-LLM distribution

SKILL.md is an open standard, so **one source, two channels — no per-runtime forks, no build step**:

| Runtime | How it installs |
|---|---|
| Claude Code | `/plugin marketplace add soohanpark/soohan-skills` — reads `.claude-plugin/marketplace.json` |
| Codex / Gemini / Kimi CLI | `./install.sh` — copies `plugins/*/skills/*/` into `~/.codex/skills/` etc. |
| Anything else with a skills dir | `./install.sh --target <dir>` (e.g. `~/.agents/skills`, auto-detected too) |

`install.sh` names the installed directory after the **plugin** (`~/.codex/skills/work`), or `<plugin>-<skill>` when a plugin ships more than one skill, and rewrites the frontmatter `name:` to match — the standard requires `name` == directory name, while sources deliberately use short inner names (see "Naming gotchas"). Slash commands (`commands/*.md`) are Claude-only and are **not** installed; other CLIs fire the skill off its `description`, so keep trigger phrases there strong enough to work without a command.

**Never create a per-runtime copy of a SKILL.md.** The moment a second copy exists the two drift.

## Runtime-neutral skill prose

Because the same file is read by every host, skill bodies must not hard-code Claude-only facts:

| Don't write | Write instead |
|---|---|
| `AskUserQuestion` | "ask the user (use a multi-select question tool if the host has one)" |
| `Write` / `Edit` / `NotebookEdit` | "file-writing tools" — Claude's names only as examples |
| `~/.claude/plugins/**` alone | all skill roots, Claude's among them |
| "the current Claude Code session" | "the current session" |
| "Invoked via the Skill tool as `x:y`" | drop it — each host advertises skills its own way |
| `pbcopy` | the clipboard command chain (`pbcopy` → `wl-copy` → `xclip` → `clip.exe`) |

Naming Claude explicitly is fine when it's one host among several ("in Claude Code the full id is `/skill-lab:explain`").

## Quick commands

```
pnpm sync       # regenerate .claude-plugin/marketplace.json from plugins/
pnpm validate   # check every plugin.json against the schema (no writes)
pnpm test       # run Vitest suite (36 tests)
./install.sh    # install skills into non-Claude CLIs (auto-detects ~/.codex ~/.gemini ~/.kimi ~/.agents)
bash tests/install.test.sh   # install.sh smoke test (not part of pnpm test — it's bash)
```

If `pnpm` is missing from `PATH`, enable Corepack (`corepack enable`) or invoke pnpm via the Corepack shim. The repo pins `packageManager: pnpm@9.12.0` so any Corepack-aware Node ≥ 20 will resolve the right version automatically.

For coverage runs, if your shell intercepts `--coverage` (e.g. via a proxy wrapper), invoke vitest directly: `pnpm exec vitest run --coverage`.

## Architecture

Three scripts in `scripts/`, all imported as ESM, run via `tsx` (no build step):

- `schema.ts` — Zod `PluginManifestSchema`. **Single source of truth** for what a `plugin.json` may contain. Both `sync.ts` and `validate.ts` import from here.
- `sync.ts` — pure `syncMarketplace(root)` function + thin `isMain()` CLI wrapper. Walks `plugins/*/`, validates, sorts by name, writes `marketplace.json`.
- `validate.ts` — non-mutating sibling. Returns `ValidationError[]`. Same checks as sync (schema, dir/name match, duplicate names) but never writes.

CLI dispatch blocks (`if (isMain()) { ... }`) are wrapped in `/* v8 ignore start/stop */` so the 80% coverage threshold targets only the testable function bodies.

`install.sh` is deliberately outside that pipeline: it is plain bash with no dependencies so `curl | bash` works on a machine that has neither this repo nor Node.

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

Claude Code namespaces skills as `<plugin>:<skill>` and commands as `<plugin>:<command>`. If the inner names match the plugin name, the listing reads e.g. `skill-lab:skill-lab` — ugly. **Use distinct inner names.** Convention in this repo: short verb names like `run`, `diff`, `trace`, `explain`. Example:

- ❌ `plugins/skill-lab/skills/SKILL.md` with `name: skill-lab` → listed as `skill-lab:skill-lab`
- ✅ `plugins/skill-lab/skills/explain/SKILL.md` with `name: explain` → listed as `skill-lab:explain`

The same applies to `commands/`: prefer `commands/explain.md` (listed as `skill-lab:explain`, invoked as `/explain` or `/skill-lab:explain`) over `commands/skill-lab.md`.

## Generated files — do not hand-edit

- `.claude-plugin/marketplace.json` — regenerated on every commit by the Husky pre-commit hook (`pnpm sync && git add .claude-plugin/marketplace.json`). Hand edits will be silently overwritten. CI on main also fails on drift via `git diff --exit-code`.
- `pnpm-lock.yaml` — pnpm-managed; commit but don't hand-edit.

## Testing rules

- **TDD only** for `scripts/*.ts` (per global coding-style rules). Tests live in `tests/<name>.test.ts`, one per script.
- **Coverage gate**: ≥80% lines/branches/functions/statements. Configured in `vitest.config.ts`. Adding a new script means adding tests that satisfy the gate.
- Tests use `mkdtempSync(tmpdir() + ...)` fixtures and `rmSync` in `afterEach`. **Never touch the real `plugins/` directory** from a test — it would interfere with the running marketplace.
- Behavior-focused asserts only (read back the written file, check the returned errors). No mocking of `fs` — use real tmpdir I/O.
- `install.sh` is covered by `tests/install.test.sh` (bash, run separately from `pnpm test`). It runs against a fake `$HOME` in a tmpdir — **never** let it write to the real `~/.codex` / `~/.gemini`.

## Workflow

1. Add or modify files under `plugins/<name>/`.
2. `git commit` — the pre-commit hook runs `pnpm sync` + auto-stages `marketplace.json`. If schema validation fails, the commit is blocked.
3. Push to `main` → GitHub Actions `verify` workflow re-runs sync, asserts no drift, runs the Vitest suite and `tests/install.test.sh`.
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

On Codex / Gemini / Kimi there is no update command — rerun the installer, which is idempotent (it wipes and recopies each skill directory):

```bash
curl -fsSL https://raw.githubusercontent.com/soohanpark/soohan-skills/main/install.sh | bash
```

## Working notes

`docs/` is gitignored. Local-only design specs and implementation plans live there (when present). When extending the marketplace, prefer writing a short spec + plan locally before touching code (per the `superpowers:brainstorming` and `superpowers:writing-plans` workflow).
