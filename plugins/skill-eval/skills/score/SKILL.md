---
name: score
description: Use when the user wants to measure whether a skill actually works — trigger accuracy, quality delta against a no-skill baseline, or regression after editing a SKILL.md (e.g. "이 스킬 평가해줘", "발동률 재줘", "스킬 품질 측정해줘", "description 고쳤는데 회귀 확인해줘"). Runs the eval harness in this repository and interprets the results. Not for writing ordinary unit tests or test code for application logic.
---

# 스킬 평가

스킬 하나의 트리거 정확도와 품질 델타를 실제 실행으로 측정한다.

## 절차는 스크립트가 한다

실행·반복·파싱·집계는 전부 결정적이므로 직접 하지 말고 이 스킬에 번들된 스크립트를 부른다.
아래의 `<eval>` 은 실행 환경에 따라 고른다:

- soohan-skills 체크아웃 안: `pnpm eval`
- 그 외 어디서든: `npx -y tsx <이 SKILL.md 가 있는 디렉터리>/scripts/cli.ts` — Node 만 있으면 된다

```bash
<eval> mine   <스킬>   # 로그 채굴 → cases.draft.jsonl
<eval> record <스킬>   # 실행 → 런 디렉터리 적재  (--runtime=claude|codex, 중단됐으면 --resume=<runId>)
<eval> judge  <runId>  # 페어와이즈 판정
<eval> report <runId>  # 표 출력
```

`<스킬>` 지정: 체크아웃 안에서는 `plugin:skill` id, 밖에서는 대상 SKILL.md 가 든 디렉터리
경로를 넘긴다 (`…/<plugin>/skills/<skill>` 모양이어야 한다 — id 형식은 체크아웃 안에서만
스킬 파일을 찾을 수 있다). 결과는 체크아웃 안이면 레포 `evals/`, 밖이면 `~/.skill-eval/` 에 쌓인다.

## 당신이 판단할 것은 셋뿐이다

**1. near-miss 선별.** `cases.draft.jsonl`을 읽고 변별력 있는 negative만 남긴다.
스킬과 아무 상관 없는 프롬프트("점심 메뉴 추천")는 통과시켜도 아무것도 검증하지 못하므로 버린다.
남길 것은 키워드가 겹치는데 실제로는 다른 처리가 맞는 애매한 것들이다.

**2. 실패 원인 진단.** 리포트의 실패 케이스를 보고 어느 쪽 문제인지 가른다.

- 오발동·미발동 → `description` 문제
- must/must_not 실패, 페어와이즈 패배 → SKILL.md 본문·참조 파일 문제

**3. `description` 재작성 제안.** 과잉 트리거면 범위를 좁히고, 미발동이면 왜·언제·어떻게를 보강한다.
하드코딩식 예외 나열이나 대문자 MUST/NEVER 남발이 아니라 "왜 이게 중요한지"를 설명하는 방향으로 쓴다.
특정 테스트 케이스에만 맞추면 과적합이다 — 목표는 보지 못한 프롬프트에서도 작동하는 것이다.

## 하지 않을 것

- **케이스를 `cases.jsonl`로 직접 승격하지 않는다.** draft에는 실사용 프롬프트 원문이 들어 있고 이 저장소는 공개다.
  후보를 정리해 보여주고 사람이 확정하게 한다.
- **SKILL.md를 직접 수정하지 않는다.** 제안까지만 한다.
- 리포트 숫자만 보고 결론짓지 않는다. 런 디렉터리(`<eval 홈>/evals/runs/<runId>/`)의 원본 JSONL을 열어 실행 과정을 확인한다.
  세 케이스 모두에서 비슷한 헬퍼를 새로 만들고 있다면 그 스킬에 스크립트를 번들해야 한다는 신호다.

## 결과 읽는 법

- **측정 대상 스킬은 세션에 설치되어 있어야 한다.** 트리거 축은 자연어 프롬프트가 실제 환경에서 스킬을 부르는지 보는 것이므로, 아직 설치·리로드하지 않은 새 스킬은 발동률이 0%로 나온다 — description 문제가 아니라 후보 목록에 없어서다. 새로 만든 스킬은 먼저 설치하고 리로드한 뒤 측정한다.
- 실행 에러는 "발동 안 함"이 아니다. 에러율이 20%를 넘으면 그 실행 전체를 버리고 다시 돌린다.
- `unstable`(3회 중 2:1)은 평균보다 중요한 신호다. 그 케이스는 description이 경계에 걸쳐 있다는 뜻이다.
- 페어와이즈 승률이 50% 근처면 **그 스킬은 존재 의미가 없다.** 개선이 아니라 폐기를 검토한다.
