# dry-skill

Preview what a Claude Code skill would do without producing real side effects.

## Install

```
/plugin marketplace add soohanpark/soohan-skills
/plugin install dry-skill@soohan-skills
```

## Usage

**Explicit — dry-run a named skill:**
```
/dry-skill superpowers:brainstorming
```

**Trigger — describe intent in natural language:**
```
/dry-skill 브레인스토밍해줘
```

## What you get

A fixed-format report with:
- A flow diagram of the skill's steps
- A step-by-step list of the tools that would be called
- A simulated result (clearly marked as simulated)
- A preview of files or state that would have changed

## What dry-skill will not do

- Will not call `Write`, `Edit`, mutating `Bash`, the `Skill` tool, or MCP write/mutation tools during simulation
- Will not partially execute a skill — if it can't simulate without side effects, it stops and reports why
- Will not invent skills that aren't in the current session's available-skills list

## Author

soohanpark
