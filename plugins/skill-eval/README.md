# skill-eval

스킬 하나의 트리거 정확도와 품질 델타를 실제 실행으로 측정하는 평가 하네스.

## 참고

하네스 스크립트가 스킬에 번들되어 있다(`skills/score/scripts/`) — **플러그인 설치만으로
어디서든 동작하며, 별도 클론이 필요 없다.** 실행에는 Node(`npx tsx`)만 있으면 된다.
결과는 soohan-skills 체크아웃 안에서 돌리면 레포 `evals/`(커밋 대상), 밖에서 돌리면
`~/.skill-eval/` 에 쌓인다.

**측정 대상 스킬은 세션에 설치·리로드되어 있어야 한다.** 트리거 축은 자연어 프롬프트가
실제 환경에서 스킬을 부르는지 보므로, 아직 설치하지 않은 새 스킬은 발동률이 0%로 나온다 —
description 결함이 아니라 후보 목록에 없어서다. 새 스킬은 먼저 설치하고 리로드한 뒤 측정한다.

## 설치

Claude Code:

```
/plugin install skill-eval@soohan-skills
/reload-plugins
```

Codex · Gemini · Kimi CLI (레포 루트에서):

```bash
./install.sh
```

## 사용법

- 자연어: "이 스킬 평가해줘", "blin-mr 발동률 좀 재줘", "description 고쳤는데 회귀 확인해줘"
- 명시 호출: `/skill-eval:score <plugin:skill>` — Claude Code 전용

## 동작

1. `eval mine <skill>` — 세션 로그에서 케이스 채굴 (사람이 검토 후 승격)
2. `eval record <skill>` — 실제 실행, `<eval 홈>/evals/runs/<runId>/`에 원본 적재 (`--runtime=claude|codex`, 중단 시 `--resume=<runId>`)
3. `eval judge <runId>` — 페어와이즈 블라인드 심판
4. `eval report <runId>` — 표 출력

`eval` = 체크아웃 안에서는 `pnpm eval`, 밖에서는 `npx tsx <스킬 디렉터리>/scripts/cli.ts`.

스킬은 이 네 단계를 순서대로 부르고, near-miss 선별·실패 원인 진단·description 재작성
제안처럼 판단이 필요한 지점에서만 개입한다.

## 이 스킬이 하지 않는 것

- `cases.draft.jsonl`을 `cases.jsonl`로 직접 승격하지 않는다 — 실사용 프롬프트 원문이 들어 있어
  사람이 확인해야 한다.
- SKILL.md를 직접 고치지 않는다 — 재작성 제안까지만 한다.
- 애플리케이션 로직의 일반 유닛 테스트 작성 요청에는 반응하지 않는다.

## Author

soohanpark
