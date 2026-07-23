# dry-skill

Preview what a skill would do without producing real side effects.

## Install

### Codex · Gemini · Kimi CLI

```bash
./install.sh            # from a clone; auto-detects ~/.codex ~/.gemini ~/.kimi ~/.agents
```

Re-run to update. Then just ask for a dry-run in natural language — there are no slash commands outside Claude Code.

### Claude Code

**First time:**
```
/plugin marketplace add soohanpark/soohan-skills
/plugin install dry-skill@soohan-skills
/reload-plugins
```

**Update (after the plugin changes upstream):**
```
/plugin marketplace update soohan-skills
/plugin uninstall dry-skill@soohan-skills
/plugin install dry-skill@soohan-skills
/reload-plugins
```

## Usage

Slash commands (Claude Code only): `/run`, or fully qualified `/dry-skill:run` when there's a name collision with another plugin. On other CLIs use the same two forms in plain text ("dry run superpowers:brainstorming").

**Explicit — dry-run a named skill:**
```
/run superpowers:brainstorming
```

**Trigger — describe intent in natural language:**
```
/run 브레인스토밍해줘
```

In Claude Code you can also activate the underlying skill directly as `dry-skill:run`.

## What you get

A fixed-format report with:
- A flow diagram of the skill's steps
- A step-by-step list of the tools that would be called
- A simulated result (clearly marked as simulated)
- A preview of files or state that would have changed

## What dry-skill will not do

- Will not call file-writing tools, mutating shell commands, real skill activation, or MCP write/mutation tools during simulation
- Will not partially execute a skill — if it can't simulate without side effects, it stops and reports why
- Will not invent skills that aren't in the current session's available-skills list

## Author

soohanpark
