---
description: Dry-run a skill with a flow diagram and simulated result, no real side effects
---

The user invoked `/run $ARGUMENTS` (full identifier: `/dry-skill:run`).

Activate the `dry-skill:run` skill from this plugin (its SKILL.md describes the full contract) and follow it precisely.

Mode selection:
- If `$ARGUMENTS` is a single token that looks like a skill identifier — bare (`brainstorming`) or plugin-qualified (`superpowers:brainstorming`) — use **Explicit mode**: dry-run that named skill.
- Otherwise, treat `$ARGUMENTS` as a natural-language description of intent and use **Trigger mode**: match the description against the available skills list, then dry-run the selected skill(s).

Constraints:
- Do **not** call any side-effecting tool during simulation.
- Output must follow the fixed template defined in the `dry-skill:run` SKILL.md.
- The Flow block must be a real ASCII box-and-arrow diagram (see SKILL.md "Flow diagram rules"). Never substitute prose or a single-line `Step 0 → Step 1 → ...` chain.
- The Step-by-step block must be a Markdown table (`# | Step | Tool | Args / Effect`), not a numbered paragraph list.
- Run the **Pre-Flight: Insufficient-Input Check** in SKILL.md before simulating. If the target skill needs user-supplied input and `$ARGUMENTS` is just a bare skill name, emit the "insufficient input" block and stop — do not fabricate a flow.
- If `$ARGUMENTS` is empty, ask the user which skill or intent to dry-run.
