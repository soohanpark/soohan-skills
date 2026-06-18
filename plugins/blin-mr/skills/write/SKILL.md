---
name: write
description: Use when the user asks for 블인팀 MR content for the current branch (e.g. "블인팀 MR 내용 작성해줘", "MR 본문 정리해줘", "블인 MR 써줘"). Analyzes committed changes against the auto-detected base branch, fills the 블인팀 fixed MR template in Korean, generates an MR title, and copies the body to the clipboard. Invoked via the Skill tool as `blin-mr:write` or the `/blin-mr` command.
---

# blin-mr:write

현재 브랜치의 커밋된 변경사항을 분석해 블인팀 고정 MR 포맷으로 한국어 제목 + 본문을
작성하고, 본문을 클립보드에 복사한다.

## Contract

아래 단계를 순서대로 수행한다. pbcopy를 제외한 모든 명령은 read-only다 — 레포 상태를
바꾸는 git 명령(add/commit/push/checkout 등)은 절대 실행하지 않는다.

### 1. 사전 검증

`git rev-parse --is-inside-work-tree`가 실패하면 "git 레포가 아닙니다"라고 알리고 중단한다.

### 2. Base 브랜치 자동 감지

아래 순서로 존재하는 첫 ref를 base로 쓴다:

1. `git symbolic-ref --short refs/remotes/origin/HEAD` (예: `origin/main`)
2. `git rev-parse --verify --quiet origin/develop`
3. `git rev-parse --verify --quiet origin/main`
4. `git rev-parse --verify --quiet origin/master`

- 전부 실패하면 사용자에게 base 브랜치를 묻는다 (AskUserQuestion).
- 현재 브랜치(`git branch --show-current`)가 base와 같은 브랜치를 가리키면 경고하고
  계속할지 확인받는다.
- diff 범위는 `merge-base(base, HEAD)..HEAD`: 이후 모든 비교는
  `BASE=$(git merge-base <base> HEAD)` 기준 `$BASE..HEAD`로 수행한다.

### 3. 변경사항 수집

1. `git log --oneline $BASE..HEAD` — 커밋 목록. 비어 있으면 "base 대비 변경이
   없습니다"라고 알리고 중단한다.
2. `git diff --stat $BASE..HEAD` — 파일별 변경 규모 파악.
3. 핵심 파일 위주로 `git diff $BASE..HEAD -- <path>`를 선별 실행해 내용을 읽는다.
   수백 줄이 넘는 대형 diff는 통째로 읽지 말고 stat과 커밋 메시지, 대표 hunk로
   파악한다.
4. `git status --porcelain`에 출력이 있으면 "커밋되지 않은 변경은 분석에서
   제외됩니다"라고 경고만 하고 진행한다.

### 4. Required Checklist 판정

| 항목 | 판정 방법 |
|---|---|
| 1. 테스트 코드 작성 | diff에 테스트 파일(`*test*`, `*spec*` 등) 추가/수정이 있으면 `[x]` |
| 2. 수동 테스트 | 사용자에게 질문 |
| 3. 코드/함수 주석 | 변경된 코드에 설명 주석 추가가 보이면 `[x]` |
| 4. e2e 확인 | 사용자에게 질문 |

2번과 4번은 AskUserQuestion **한 번**(multiSelect)으로 같이 묻는다:
"이번 변경에서 직접 수행한 항목을 골라주세요" — 선택지: "수동 테스트 완료" /
"e2e 테스트 완료". 선택된 항목만 `[x]`.

### 5. 제목 + 본문 작성

- 언어: 한국어 (코드 식별자·기술 용어는 원문 유지).
- 문체: 본문 서술은 정중한 하십시오체(`~합니다`/`~했습니다`/`~입니다`)로 쓴다. `~했다`/`~한다`
  같은 평서체로 끝내지 않는다. (예외: 아래 Required Checklist의 고정 문구는 절대 바꾸지 않는다.)
- 제목: 1줄. 브랜치명과 커밋 메시지를 참고해 변경 전체를 요약한다.
  conventional 톤 (예: `feat: 주문 취소 사유 입력 기능 추가`).
- 본문: 아래 고정 포맷을 그대로 쓰되, `//` 주석 줄은 분석한 실제 내용으로 대체한다.
  섹션 제목·순서·헤딩 레벨·체크리스트 문구는 절대 변경하지 않는다.

```
## Summary
(1-3줄 요약)

### Motivation
(이 MR이 필요한 이유, 코드를 변경한 배경)

### Key changes
(핵심 변경 사항 — 필요하면 bullet 목록)

### To reviewer
(리뷰어가 알아야 할 컨텍스트, 중점적으로 봐줬으면 하는 부분)

### Required Checklist
- [ ] 나는 테스트 코드를 작성했다.
- [ ] 나는 코드의 동작을 수동으로 테스트했다.
- [ ] 나는 코드/함수에 적절한 주석으로 설명했다.
- [ ] 나는 e2e 테스트로 각 서비스의 정상 동작을 확인했다.
```

체크리스트는 4단계 판정 결과에 따라 `[ ]`/`[x]`를 채운다.

### 6. 출력 + 클립보드 복사

1. 화면에 **제목 1줄 + 본문 전체**를 출력한다 (사용자 확인용).
2. **본문만** pbcopy로 복사한다. 단일 quoted heredoc을 사용해 셸 해석을 막는다:

```bash
pbcopy <<'MR_BODY'
(본문 전체)
MR_BODY
```

3. "MR 본문을 클립보드에 복사했습니다. 제목은 GitLab에 직접 입력해주세요."라고
   명시적으로 알린다.
4. pbcopy가 실패하면(비-macOS 등) 본문이 이미 화면에 출력되어 있으니 수동 복사를
   안내한다.

## What this skill is NOT

- GitLab API로 MR을 생성/수정하지 않는다. 클립보드 복사까지가 범위다.
- 커밋·푸시 등 레포 상태를 바꾸지 않는다.
- 블인팀 포맷 전용이다. 다른 포맷 요청이면 이 스킬을 쓰지 않는다.
