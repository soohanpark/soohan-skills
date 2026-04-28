---
name: run
description: Use when the user wants to preview what a skill would do without producing real side effects. Activates explicitly via `/run <skill-name>` (full id `/dry-skill:run`) or implicitly when the user wraps a request in a dry-run intent (e.g. "dry run the brainstorming skill on this prompt"). Invoked via the Skill tool as `dry-skill:run`.
---

# dry-skill:run

Preview what a skill would do, without running it for real. Useful for understanding skill behavior before committing to actual execution.

## Two Invocation Modes

| Mode | Form | Behavior |
|---|---|---|
| Explicit | `/run <skill-name>` | Dry-run the named skill |
| Trigger | `/run <natural language>` | Match the prompt to available skills, then dry-run them |

In Explicit mode, `<skill-name>` is either a bare name (`brainstorming`) or a plugin-qualified name (`superpowers:brainstorming`). The full slash-command identifier is `/dry-skill:run` if `/run` collides with another plugin.

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

## Pre-Flight: Insufficient-Input Check

Before any simulation, verify the invocation has enough input to produce a meaningful flow. If the user passed **only a bare skill name** (Explicit mode with no extra context) and the target skill's behavior depends on user-supplied input — a prompt, file path, target text, query, location, etc. — you MUST stop and ask, rather than fabricate a flow.

How to decide:

- Read the target skill's `description` and `SKILL.md`. Look for required inputs: "Use when the user asks for X about Y", "Search for ...", "Convert <input> to ...", parameters in examples.
- If the skill is **purely procedural** (e.g. `verification-before-completion`, `writing-plans` operating on conversation context), bare-name invocation is fine — proceed.
- If the skill needs **concrete user data** (e.g. `korean-spell-check` needs text, `real-estate-search` needs a region, `frontend-design` needs a UI brief), bare-name invocation is **not** enough.

When stopping, emit exactly this block (no Flow, no Step-by-step):

````
## Dry-run: <skill name> — insufficient input

This skill requires <what's missing> to produce a meaningful dry-run. Without it, any simulated flow would be fabricated.

**How to invoke it:**
- `/run <skill name> <example concrete input>`
- or describe the intent in natural language: `/run <example natural-language request>`
````

Replace `<example concrete input>` and `<example natural-language request>` with **two realistic examples** drawn from the target skill's own description/examples.

## Output Format (fixed)

Always emit exactly this structure. Omit the "Files / state" section if nothing would have changed.

````
## Dry-run: <skill name(s)>

### Flow

```
<ASCII box-and-arrow diagram — see "Flow diagram rules" below>
```

### Step-by-step

| # | Step | Tool | Args / Effect |
|---|------|------|---------------|
| 1 | [<skill>] <short label> | `<tool>` | <args summary or "—"> |
| 2 | ... | ... | ... |

### Simulated result
<What the skill would have produced. Be explicit that this is simulated, not real output.>

### Files / state that would have changed
- `<path>`: <preview of the intended change>
````

### Flow diagram rules

The Flow block MUST be a real ASCII diagram — boxes connected by arrows — not a paragraph or an inline arrow-separated list. Use one of these two layouts:

**Vertical (preferred for ≤ 8 steps):**

```
┌──────────────────────────┐
│ 0. introspect project    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 1. load MCP tools        │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 2. normalize input       │
└──────────────────────────┘
```

**Horizontal columns (for > 8 steps or chained skills):**

```
┌────────────┐    ┌────────────┐    ┌────────────┐
│ 0. intro   │ ─▶ │ 1. load    │ ─▶ │ 2. norm    │
└────────────┘    └────────────┘    └────────────┘
                                          │
       ┌──────────────────────────────────┘
       ▼
┌────────────┐    ┌────────────┐
│ 3. fetch   │ ─▶ │ 4. emit    │
└────────────┘    └────────────┘
```

Hard rules:

- Every node is a labeled box with `┌─┐ │ │ └─┘` (or `+--+ | | +--+` if Unicode is unsafe).
- Arrows are `─▶`, `▼`, `▲`, `◀` — not `->` or `→` glyphs in a sentence.
- For chained skills, mark the handoff with a separator line containing the next skill's name, e.g. `══ handoff → writing-plans ══`.
- Never replace the diagram with prose or a single-line `Step 0 → Step 1 → Step 2` chain. If you find yourself writing arrows inside a paragraph, stop and redraw as boxes.

## What Dry-Skill is NOT

- Not a way to "test" a skill — there is no validation pass/fail. It only describes what would happen.
- Not a partial execution — either the simulation is fully side-effect-free, or you stop and report why.
- Not for skills the user has not granted access to. If the target skill is not in the available skills list, say so.
