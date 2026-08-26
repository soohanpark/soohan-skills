---
description: 다른 스킬이 어떻게 동작하는지 플로우 다이어그램 + 단계 표로 설명 (실행하지 않음)
---

The user invoked `/explain $ARGUMENTS` (full identifier: `/skill-lab:explain`).

Activate the `skill-lab:explain` skill from this plugin (its SKILL.md describes the full contract) and follow it precisely.

Target selection:
- If `$ARGUMENTS` is a skill identifier — bare (`brainstorming`) or plugin-qualified (`superpowers:brainstorming`) — explain that skill.
- Otherwise treat `$ARGUMENTS` as a natural-language description and match it against the available skills list first, then explain the match.
- If `$ARGUMENTS` is empty, ask which skill to explain.

Constraints:
- Read the target's actual `SKILL.md` before drawing anything. If it can't be found, say so and stop — never diagram a skill from its name alone.
- Never activate the target skill and never call a side-effecting tool.
- Output must follow the fixed template in SKILL.md, and the Flow block must be a real ASCII box-and-arrow diagram — never prose, never a single-line arrow chain.
- Steps must be a Markdown table (`# | Step | Tool | Args / Effect`), not a numbered paragraph list.
