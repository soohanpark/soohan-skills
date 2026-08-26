---
name: explain
description: Use when the user wants to understand how a skill works before or instead of running it — "이 스킬 어떻게 동작해?", "스킬 흐름 다이어그램으로 보여줘", "explain how the brainstorming skill works", "what would this skill actually do?". Reads the target skill's SKILL.md and renders its procedure as an ASCII flow diagram plus a step table, without activating it. Not for explaining application code — only skills.
---

# Explain a skill

Turn another skill's `SKILL.md` into a picture: an ASCII flow diagram of its procedure, a step table
of the tools it would reach for, and the side effects it would cause. Nothing is executed.

## Two ways in

| Form | Behavior |
|---|---|
| A skill identifier — `brainstorming`, `superpowers:brainstorming` | Explain that skill |
| Natural language — "브레인스토밍 스킬 어떻게 도는 거야" | Match the intent against the session's available-skills list, then explain the match |

In Claude Code the slash command is `/explain` (`/skill-lab:explain` if it collides). Other hosts
activate the skill from the same two forms in plain text.

## Contract

1. **Get the real definition.** If the host already surfaced the target's content, use it. Otherwise
   search the skill roots for its `SKILL.md` and read it — `~/.claude/skills/`, `~/.claude/plugins/`,
   `~/.codex/skills/`, `~/.gemini/skills/`, `~/.kimi/skills/`, `~/.agents/skills/`, plus project-local
   `.claude/skills/` and `skills/`. Read the files it references (scripts, templates) when the flow
   depends on them.
2. **Never guess.** If you cannot find the definition, say so and stop. Explaining a skill from its
   name alone produces a fabricated diagram, which is worse than no answer.
3. **Never activate it.** Reading is the whole job. Read-only tools (file read, glob, grep, `git log`,
   `ls`, `cat`) are fine. Do not call file-writing tools, mutating shell commands, mutating MCP tools,
   or the target skill itself.
4. **Explain the mechanism, not the marketing.** Every node in the diagram must correspond to an
   instruction actually written in the target's `SKILL.md`. Branches, stop conditions, and questions
   it asks the user are part of the mechanism — show them.

When the user supplies concrete input alongside the skill name ("explain what the MR skill would do
on this branch"), ground the diagram in that input: same structure, but the step table says what the
arguments would actually be. Without concrete input, describe the skill's general procedure — a bare
skill name is a perfectly normal invocation, not missing information.

## Resolving a natural-language target

1. Match the intent against the **available skills list exposed in the current session** — every host
   advertises its loaded skills with descriptions. That list is authoritative; don't crawl the
   filesystem to discover candidates.
2. 0 matches → say so and stop. Several matches → name the one you picked and why.
3. If the skills chain (e.g. brainstorming → writing-plans), diagram them in order with a handoff
   marker between them.

## Output format (fixed)

````
## <skill id> — how it works

<One or two sentences: what the skill is for and what it produces.>

### Flow

```
<ASCII box-and-arrow diagram — see rules below>
```

### Steps

| # | Step | Tool | Args / Effect |
|---|------|------|---------------|
| 1 | <short label> | `<tool>` | <args summary or "—"> |

### Side effects & guardrails
- Writes: <files / clipboard / network, or "none — read-only">
- Asks the user: <what it stops to ask, or "nothing">
- Refuses to: <what the skill explicitly forbids itself>
````

Drop the last section's bullets that don't apply. Add a short `### Notes` only when something in the
definition is genuinely ambiguous.

### Flow diagram rules

The Flow block MUST be a real ASCII diagram — boxes connected by arrows — never a paragraph and never
an inline `Step 1 → Step 2 → Step 3` chain.

**Vertical (preferred, ≤ 8 steps):**

```
┌──────────────────────────┐
│ 1. detect base branch    │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 2. collect diff          │
└────────────┬─────────────┘
             ▼
┌──────────────────────────┐
│ 3. ask: manual / e2e?    │
└──────────────────────────┘
```

**Horizontal columns (> 8 steps, or chained skills):**

```
┌────────────┐    ┌────────────┐    ┌────────────┐
│ 1. detect  │ ─▶ │ 2. collect │ ─▶ │ 3. ask     │
└────────────┘    └────────────┘    └────────────┘
                                          │
       ┌──────────────────────────────────┘
       ▼
┌────────────┐    ┌────────────┐
│ 4. draft   │ ─▶ │ 5. copy    │
└────────────┘    └────────────┘
```

Hard rules:

- Every node is a labeled box: `┌─┐ │ │ └─┘` (or `+--+ | | +--+` where Unicode is unsafe).
- Arrows are `─▶ ▼ ▲ ◀`, never `->` or a `→` inside a sentence.
- Show branches as forks with the condition on the arrow, e.g. `│ no commits ▼` into a `stop` box.
  A skill's exit conditions are the most useful thing on the diagram.
- Mark a handoff between chained skills with a separator line: `══ handoff → writing-plans ══`.
- If you catch yourself writing arrows inside a paragraph, stop and redraw as boxes.

## What this is not

- Not an execution, not a partial execution, and not a "test" — there is no pass/fail. Use
  `skill-lab:score` to actually measure whether a skill triggers and helps.
- Not a summary of the skill's prose. A diagram that just restates the description is a failed
  explanation; the value is in the order, the branches, and the stop conditions.
- Not for skills outside the session's available list or the skill roots. Say it's not there.
