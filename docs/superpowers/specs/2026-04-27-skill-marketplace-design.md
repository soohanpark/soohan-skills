# Skill Marketplace — Design Spec

- **Date:** 2026-04-27
- **Owner:** soohanpark
- **Repo:** `soohan-skills`
- **Status:** Approved for implementation planning

## 1. Goal

Build a personal Claude Code plugin marketplace that:

1. Stores **self-authored plugins** in the repo and exposes them through Claude Code's official plugin marketplace mechanism (`/plugin marketplace add`).
2. Generates the marketplace manifest **automatically** from the contents of `plugins/` so the manifest never drifts from source.
3. Enforces a curated metadata schema (category, tags) on every plugin.
4. Ships with one seed plugin — `dry-skill` — that demonstrates the workflow end-to-end.

External plugin curation (referencing third-party repos via `marketplace.json`) is **out of scope** for this iteration. The structure does not preclude adding it later.

## 2. Repository Layout

```
soohan-skills/
├── .claude-plugin/
│   └── marketplace.json          # generated; do not edit by hand
├── plugins/
│   └── <plugin-name>/
│       ├── .claude-plugin/
│       │   └── plugin.json       # source of truth for plugin metadata
│       ├── skills/SKILL.md       # optional
│       ├── commands/             # optional
│       ├── agents/               # optional
│       └── README.md
├── scripts/
│   ├── sync.ts                   # plugins/ → marketplace.json
│   └── validate.ts               # plugin.json schema validator
├── tests/
│   └── sync.test.ts              # Vitest suite
├── docs/superpowers/specs/       # design specs (this file)
├── .husky/pre-commit
├── .github/workflows/verify.yml
├── package.json
├── tsconfig.json
└── README.md
```

Naming rules:

- Plugin directories use **kebab-case** and must match the `name` field in `plugin.json`.
- `marketplace.json` is **generated**; pre-commit hook auto-stages it. Manual edits will be overwritten and CI will fail on drift.

## 3. Plugin Metadata Schema (`plugin.json`)

Validated with Zod in `scripts/validate.ts`. All fields below are part of the contract.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | kebab-case; must equal directory name |
| `version` | string | yes | semver (`^\d+\.\d+\.\d+$` plus pre-release suffix allowed) |
| `description` | string | yes | non-empty |
| `author` | `{ name: string, email?: string, url?: string }` | yes | |
| `category` | string | yes | curation field; free-form but lowercase kebab-case (e.g. `dev-tools`, `meta`, `korean-services`) |
| `tags` | `string[]` | yes | ≥ 1 entry; lowercase kebab-case |
| `homepage` | string (URL) | no | |
| `license` | string | no | SPDX identifier |

Example:

```jsonc
{
  "name": "dry-skill",
  "version": "0.1.0",
  "description": "Dry-run any skill with a flow diagram and simulated result",
  "author": { "name": "soohanpark" },
  "category": "meta",
  "tags": ["dry-run", "preview", "skill-introspection"]
}
```

## 4. Generated `marketplace.json`

```jsonc
{
  "name": "soohan-skills",
  "owner": { "name": "soohanpark" },
  "plugins": [
    {
      "name": "dry-skill",
      "source": "./plugins/dry-skill",
      "description": "Dry-run any skill with a flow diagram and simulated result",
      "version": "0.1.0",
      "category": "meta",
      "tags": ["dry-run", "preview", "skill-introspection"]
    }
  ]
}
```

Output rules:

- `plugins` array is sorted by `name` ascending — guarantees stable diffs.
- 2-space indentation, trailing newline.
- File header is **not** emitted (Claude Code rejects unknown top-level fields).

## 5. `sync.ts` Behavior

Pseudocode:

```
plugins = readdirSync('plugins/').filter(isDirectory)
entries = []
for dir in plugins:
  manifestPath = plugins/<dir>/.claude-plugin/plugin.json
  manifest = parse(manifestPath)
  validate(manifest)                         # Zod; throw on failure
  assert manifest.name === dir               # consistency
  entries.push(toMarketplaceEntry(manifest, source: `./plugins/${dir}`))
entries.sort(by name)
writeFile('.claude-plugin/marketplace.json', stringify({ name, owner, plugins: entries }))
```

Failure modes (all raise non-zero exit, blocking the commit/CI):

- `plugin.json` missing
- Schema violation
- Directory name ≠ `name` field
- Duplicate `name` across plugins

## 6. Pre-commit Hook (`.husky/pre-commit`)

```bash
#!/usr/bin/env sh
pnpm sync && git add .claude-plugin/marketplace.json
```

- Runs `sync` on every commit. If sync fails (validation), the commit is blocked.
- Auto-stages the regenerated manifest so contributor doesn't need a second commit.

## 7. CI (`.github/workflows/verify.yml`)

Trigger: `push` to `main` only. Steps:

1. Checkout
2. Setup Node + pnpm (`packageManager` field in `package.json`)
3. `pnpm install --frozen-lockfile`
4. `pnpm sync`
5. `git diff --exit-code .claude-plugin/marketplace.json` — fails the run if pre-commit was bypassed and the manifest is stale
6. `pnpm test` — runs the Vitest suite

PRs do **not** run CI. Rationale: this is a single-maintainer repo; pre-commit handles the local case and main-only CI catches anything that slipped through.

## 8. Tests (Vitest, target ≥ 80% line coverage)

`tests/sync.test.ts` covers:

- Happy path: 2 plugins, output is sorted, fields propagated correctly
- Validation rejects: missing `name`, bad semver, missing `tags`, empty `tags`, unknown category type
- Directory/name mismatch is rejected
- Duplicate `name` across plugins is rejected
- Empty `plugins/` produces a manifest with `plugins: []`
- Output is byte-stable across two consecutive runs (idempotency)

Tests run against an in-memory or tmp directory fixture; no real filesystem mutation outside the tmp dir.

## 9. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Node ≥ 20, executed via `tsx` (no build step) |
| Package manager | pnpm |
| Schema validation | Zod |
| Test framework | Vitest |
| Pre-commit | Husky |
| CI | GitHub Actions |

`package.json` scripts:

```jsonc
{
  "scripts": {
    "sync": "tsx scripts/sync.ts",
    "validate": "tsx scripts/validate.ts",
    "test": "vitest run",
    "prepare": "husky"
  }
}
```

## 10. End-User Workflow

**Adding a new plugin (maintainer)**

```bash
mkdir -p plugins/<name>/.claude-plugin
# author plugin.json, skills/SKILL.md, commands/, etc.
git add plugins/<name>
git commit -m "feat(<name>): add plugin"
# pre-commit runs sync, regenerates marketplace.json, auto-stages it
```

**Consuming the marketplace (any environment)**

```
/plugin marketplace add soohanpark/soohan-skills
/plugin install dry-skill@soohan-skills
```

## 11. Seed Plugin: `dry-skill`

The marketplace ships with one plugin to dogfood the workflow.

### 11.1 Purpose

Preview what a skill would do without producing real side effects. Helps the user understand which skill(s) would fire for a given prompt and what each step would do, before committing to an actual run.

### 11.2 Two Invocation Modes

| Mode | Form | Behavior |
|---|---|---|
| Explicit | `/dry-skill superpowers:brainstorming` | Dry-run the named skill |
| Trigger | `/dry-skill 브레인스토밍해줘` | Infer which skill(s) the prompt would activate, then dry-run them |

### 11.3 Dry-Run Contract

The SKILL.md body MUST instruct Claude to:

- Read the target skill's SKILL.md and follow its logic mentally
- **Not** call any side-effecting tool: `Write`, `Edit`, `NotebookEdit`, `Bash` commands that mutate state, `Skill` (no real skill activation), MCP write/mutation tools
- Read-only tools are **allowed** when needed for accurate simulation: `Read`, `Glob`, `Grep`, read-only `Bash` (e.g. `git status`, `git log`)
- Surface, for each step, the tool that *would* be called and the arguments that *would* be passed

If a target skill cannot be simulated without side effects (e.g. requires real network mutations), `dry-skill` reports that fact and stops.

### 11.4 Trigger-Mode Skill Resolution

When invoked in trigger form:

1. Parse user intent from the natural-language argument
2. Match against the **available skills list exposed in the current Claude Code session** (the `available skills` block in the session's system reminder is the authoritative source — both built-in skills and any installed plugins' skills appear there with their descriptions). Do not crawl the filesystem; trust what the runtime advertises.
3. Apply the superpowers priority rule: process skills before implementation skills
4. If 0 matches → report and stop. If ≥ 1 → state the selected skill(s) and the matching rationale, then proceed
5. For chains (multiple skills triggered in sequence), simulate them in order and combine the diagrams

### 11.5 Output Format (fixed template)

```
## Dry-run: <skill name(s)>

### Flow
<ASCII or mermaid diagram of the skill steps>

### Step-by-step
1. [<skill>] <step description> — would call <tool>(<args summary>)
2. ...

### Simulated result
<What the skill would have produced. Clearly marked as simulated.>

### Files / state that would have changed
- <path>: <preview of intended change>
```

If no files would change, that section is omitted.

### 11.6 Plugin Layout

```
plugins/dry-skill/
├── .claude-plugin/plugin.json
├── skills/SKILL.md          # description triggers natural-language activation
├── commands/dry-skill.md    # /dry-skill slash command
└── README.md
```

### 11.7 Out of Scope (for this spec)

The full SKILL.md prose, exact prompting, and worked example outputs are deferred to the implementation phase. This spec fixes only the **interface contract**:

- The two invocation modes
- The dry-run side-effect ban (with the read-only exemption)
- The trigger-mode resolution rules
- The fixed output template

## 12. Out of Scope

- External plugin curation (third-party repos referenced from `marketplace.json`)
- A web UI / catalog site
- Usage statistics, favorites, or any local state file
- Migrating the existing single-file references in `~/.claude/skills/` (e.g. `backend-patterns.md`); they remain as global reference docs, not marketplace plugins

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Maintainer hand-edits `marketplace.json` | Pre-commit regenerates and auto-stages; CI fails on drift |
| Schema drift between `plugin.json` and Claude Code's plugin spec | Zod schema is the single point of update; integration test asserts a real Claude Code plugin install round-trip in a future iteration (not this spec) |
| Dry-skill accidentally produces real side effects | Explicit tool-ban list in SKILL.md + the simulated-result section forces Claude to articulate intent rather than execute |
| `plugins/` grows large enough that flat listing is unwieldy | `category` field exists in metadata; future iteration can add grouping at render time without schema change |

## 14. Success Criteria

1. `pnpm sync` produces a valid `marketplace.json` from `plugins/`, idempotent across runs.
2. A bad `plugin.json` (missing field, bad semver, name mismatch) blocks the commit.
3. The repo can be added via `/plugin marketplace add soohanpark/soohan-skills` and `dry-skill` can be installed via `/plugin install dry-skill@soohan-skills`.
4. After install, both `/dry-skill <skill-name>` and `/dry-skill <natural language>` produce output matching the fixed template.
5. CI on `main` is green.
6. Vitest line coverage on `scripts/sync.ts` and `scripts/validate.ts` ≥ 80%.
