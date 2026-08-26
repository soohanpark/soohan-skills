# work

업무용 스킬 모음.

| 스킬 | 하는 일 |
|---|---|
| `work:write-mr` | 현재 브랜치의 커밋된 변경사항을 분석해 블인팀 고정 MR 포맷(한국어)으로 제목 + 본문을 작성하고, 본문을 클립보드에 복사 |

## write-mr — MR 본문 작성

### 사용법

- 자연어: "블인팀 MR 내용 작성해줘" (모든 CLI 공통)
- 명시 호출: `/write-mr` (충돌 시 `/work:write-mr`) — Claude Code 전용

### 동작

1. base 브랜치 자동 감지 (`origin/HEAD` → `origin/develop` → `origin/main` → `origin/master`)
2. `merge-base..HEAD` 범위의 커밋·diff 분석 (read-only)
3. Required Checklist: 테스트 코드·주석은 diff 근거로 자동 체크, 수동/e2e 테스트는 질문
4. 제목 1줄 + 고정 포맷 본문 생성 → 본문만 클립보드 복사

클립보드는 `pbcopy`(macOS) → `wl-copy` → `xclip` → `clip.exe` 순으로 있는 것을 쓰고,
전부 없으면 본문이 화면에 출력되니 수동 복사하면 된다.

## 설치

Claude Code:

```
/plugin install work@soohan-skills
/reload-plugins
```

Codex · Gemini · Kimi CLI (레포 루트에서):

```bash
./install.sh
```
