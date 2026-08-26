# soohan-skills

Personal skill marketplace. Curated, self-authored plugins, installable from **any** LLM CLI that reads the [Agent Skills](https://code.claude.com/docs/en/skills) `SKILL.md` standard.

| Runtime | Install |
|---|---|
| Claude Code | `/plugin marketplace add soohanpark/soohan-skills` |
| Codex · Gemini · Kimi CLI | `curl -fsSL https://raw.githubusercontent.com/soohanpark/soohan-skills/main/install.sh \| bash` |

## Claude Code

**Install (first time):**
```
/plugin marketplace add soohanpark/soohan-skills
/plugin install <plugin-name>@soohan-skills
/reload-plugins
```

**Update (when a plugin changes upstream):**
```
/plugin marketplace update soohan-skills
/plugin uninstall <plugin-name>@soohan-skills
/plugin install <plugin-name>@soohan-skills
/reload-plugins
```

`marketplace update` only refreshes the catalog. To pick up new SKILL/command/agent files in an already-installed plugin, you need the uninstall → install → reload cycle.

Browse available plugins in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) or under [`plugins/`](plugins/).

## Codex CLI · Gemini CLI · Kimi CLI · anything else

```bash
curl -fsSL https://raw.githubusercontent.com/soohanpark/soohan-skills/main/install.sh | bash
```

Auto-detects `~/.codex` `~/.gemini` `~/.kimi` `~/.agents` and copies every skill into each one's `skills/` directory. Cloned the repo already? Just `./install.sh`. Other locations: `./install.sh --target <skills-dir>` (repeatable).

Skills land under the plugin's name (`~/.codex/skills/work`), or `<plugin>-<skill>` when a plugin ships several (`~/.codex/skills/skill-lab-explain`), and fire off their `description` — there is nothing to configure. Re-run the same command to update; it is idempotent.

Slash commands are Claude-only and are not installed. Ask for the skill by name or intent instead of typing `/write-mr`.

## Add a new plugin (maintainer)

1. Create a directory under `plugins/<name>/` with a kebab-case name.
2. Add `plugins/<name>/.claude-plugin/plugin.json` matching the schema in [`scripts/schema.ts`](scripts/schema.ts).
3. Add skill/command/agent files as needed.
4. `git commit` — the pre-commit hook regenerates `marketplace.json` and auto-stages it.

## Required `plugin.json` fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | kebab-case; must equal directory name |
| `version` | string | semver |
| `description` | string | non-empty |
| `author` | `{ name, email?, url? }` | |
| `category` | string | kebab-case |
| `tags` | `string[]` | ≥ 1 entry, kebab-case |
| `homepage` | string | optional, URL |
| `license` | string | optional, SPDX |

## Scripts

- `pnpm sync` — regenerate `marketplace.json` from `plugins/`
- `pnpm validate` — validate every `plugin.json` without writing anything
- `pnpm test` — run the test suite

## Layout

```
plugins/<name>/                          your plugin lives here (single source of truth)
install.sh                               installs skills into non-Claude CLIs
AGENTS.md                                canonical repo instructions (CLAUDE.md/GEMINI.md just import it)
.claude-plugin/marketplace.json          generated; do not hand-edit
scripts/{schema,sync,validate}.ts        sync engine
.husky/pre-commit                        regenerates marketplace.json on commit
.github/workflows/verify.yml             CI on main
```

## Plugins

See `plugins/<name>/README.md` for each plugin's docs.

- [`work`](plugins/work/README.md) — 업무 스킬 (`write-mr`: write a 블인팀 MR body from the current branch)
- [`skill-lab`](plugins/skill-lab/README.md) — skills about skills (`explain`: diagram how a skill works, `score`: measure trigger accuracy and quality delta)
- [`document`](plugins/document/README.md) — skills for documents people read: write, revise, proofread, review, summarize, and convert them (currently `writing-post`: blog posts and project write-ups)
