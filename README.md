# soohan-skills

Personal Claude Code plugin marketplace. Curated, self-authored plugins.

## Use this marketplace

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
plugins/<name>/                          your plugin lives here
.claude-plugin/marketplace.json          generated; do not hand-edit
scripts/{schema,sync,validate}.ts        sync engine
.husky/pre-commit                        regenerates marketplace.json on commit
.github/workflows/verify.yml             CI on main
```

## Plugins

See `plugins/<name>/README.md` for each plugin's docs.

- [`dry-skill`](plugins/dry-skill/README.md) — dry-run any skill with a flow diagram
