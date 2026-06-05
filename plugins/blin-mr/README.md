# blin-mr

현재 브랜치의 커밋된 변경사항을 분석해 블인팀 고정 MR 포맷(한국어)으로 제목 + 본문을
작성하고, 본문을 클립보드(`pbcopy`)에 복사한다.

## 사용법

- 자연어: "블인팀 MR 내용 작성해줘"
- 명시 호출: `/blin-mr` (충돌 시 `/blin-mr:blin-mr`)

## 동작

1. base 브랜치 자동 감지 (`origin/HEAD` → `origin/develop` → `origin/main` → `origin/master`)
2. `merge-base..HEAD` 범위의 커밋·diff 분석 (read-only)
3. Required Checklist: 테스트 코드·주석은 diff 근거로 자동 체크, 수동/e2e 테스트는 질문
4. 제목 1줄 + 고정 포맷 본문 생성 → 본문만 클립보드 복사

## 설치

```
/plugin install blin-mr@soohan-skills
/reload-plugins
```

macOS 전용 (`pbcopy`). 다른 OS에서는 본문을 화면에서 수동 복사.
