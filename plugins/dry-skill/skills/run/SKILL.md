---
name: run
description: Use when the user wants to preview what a skill would do without producing real side effects. Activates explicitly via `/dry-skill <skill-name>` or implicitly when the user wraps a request in a dry-run intent (e.g. "dry run the brainstorming skill on this prompt"). Invoked via the Skill tool as `dry-skill:run`.
---

# dry-skill:run

Preview what a skill would do, without running it for real. Useful for understanding skill behavior before committing to actual execution.

## Two Invocation Modes

| Mode | Form | Behavior |
|---|---|---|
| Explicit | `/dry-skill <skill-name>` | Dry-run the named skill |
| Trigger | `/dry-skill <natural language>` | Match the prompt to available skills, then dry-run them |

In Explicit mode, `<skill-name>` is either a bare name (`brainstorming`) or a plugin-qualified name (`superpowers:brainstorming`).

## Dry-Run Contract

You MUST:

1. Locate the target skill's definition. If the Skill tool has surfaced its content already, use that. Otherwise, find the skill's `SKILL.md` (e.g. via `Glob` over `~/.claude/plugins/**/SKILL.md` and `Read`) and read it.
2. Walk through the skill's instructions step by step in your head.
3. **NOT** call any side-effecting tool during the simulation:
   - `Write`, `Edit`, `NotebookEdit`
   - `Bash` commands that mutate state (anything other than read-only inspection)
   - The `Skill` tool itself (no real activation of the target skill — you are simulating it, not running it)
   - MCP tools that mutate external systems (anything that posts, sends, creates, updates, deletes)
4. You **MAY** call read-only tools when needed for accurate simulation:
   - `Read`, `Glob`, `Grep`
   - `Bash` for read-only inspection (`git status`, `git log`, `ls`, `cat` for files outside the project that can't be `Read`'d)
5. For every step the target skill would take, surface:
   - Which tool would be called
   - What arguments would be passed (summarized; full payloads only when material)
   - What the expected effect would be

If the target skill's logic cannot be simulated without side effects (e.g. it requires real network mutations to learn its next step), report this and stop. Do **not** fall back to running the skill for real.

## Trigger-Mode Skill Resolution

When invoked with a natural-language argument:

1. Parse the user's intent from the argument.
2. Match against the **available skills list exposed in the current Claude Code session** (the system reminder lists every skill the runtime advertises, with its description). This is the authoritative source — do **not** crawl the filesystem to discover skills.
3. Apply the superpowers priority rule: process skills (e.g. `brainstorming`, `debugging`) come before implementation skills (e.g. `frontend-design`, `mcp-builder`).
4. If 0 skills match, report this and stop. If ≥ 1 match, state the selected skill(s) and the matching rationale, then proceed.
5. If multiple skills would chain (e.g. brainstorming → writing-plans), simulate them in order. Combine their flows into a single diagram with a clear handoff marker.

## Output Format (fixed)

Always emit exactly this structure. Omit the "Files / state" section if nothing would have changed.

````
## Dry-run: <skill name(s)>

### Flow

```
<ASCII or mermaid diagram of the skill's steps>
```

### Step-by-step
1. [<skill>] <step description> — would call `<tool>(<args summary>)`
2. ...

### Simulated result
<What the skill would have produced. Be explicit that this is simulated, not real output.>

### Files / state that would have changed
- `<path>`: <preview of the intended change>
````

## What Dry-Skill is NOT

- Not a way to "test" a skill — there is no validation pass/fail. It only describes what would happen.
- Not a partial execution — either the simulation is fully side-effect-free, or you stop and report why.
- Not for skills the user has not granted access to. If the target skill is not in the available skills list, say so.
