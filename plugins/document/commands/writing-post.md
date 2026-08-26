---
description: 블로그 글을 다섯 단계 절차(ABT → 뼈대 → 초고 → 세 번 퇴고 → 제목·summary)로 쓰거나 고친다
---

The user invoked `/writing-post` (full identifier: `/document:writing-post`).

Activate the `document:writing-post` skill from this plugin (its SKILL.md describes the full procedure) and follow it step by step.

Constraints:
- Every step ends on its completion criterion; do not start the next step before the current one is met.
- Facts come from the repository and the user's own records; reasons and feelings come only from the user. An unconfirmed reason becomes a question, never prose.
- Project writing rules (frontmatter, slug, summary, tags, build checks) take precedence over the skill.
- If `$ARGUMENTS` is non-empty, treat it as the target: a path to an existing post (rewrite or polish it) or a topic and material for a new one.
