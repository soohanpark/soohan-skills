---
description: 현재 브랜치 변경사항으로 블인팀 MR 제목+본문을 작성하고 본문을 클립보드에 복사
---

The user invoked `/write-mr $ARGUMENTS` (full identifier: `/work:write-mr`).

Activate the `work:write-mr` skill from this plugin (its SKILL.md describes the full contract) and follow it precisely.

Constraints:
- All git commands are read-only; never run state-changing git commands.
- The MR body format in SKILL.md is fixed — never alter section titles, order, heading levels, or checklist wording.
- Copy only the body to the clipboard; show title + body on screen.
- If `$ARGUMENTS` is non-empty, treat it as extra context from the user (e.g. base branch override, points to emphasize for reviewers) and apply it within the SKILL.md contract.
