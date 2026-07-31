# skill-eval

스킬 하나의 트리거 정확도와 품질 델타를 실제 실행으로 측정하는 평가 하네스.

## 참고

하네스 스크립트가 스킬에 번들되어 있다(`skills/score/scripts/`) — **플러그인 설치만으로
어디서든 동작하며, 별도 클론이 필요 없다.** 실행에는 Node(`npx tsx`)만 있으면 된다.
결과는 soohan-skills 체크아웃 안에서 돌리면 레포 `evals/`(커밋 대상), 밖에서 돌리면
`~/.skill-eval/` 에 쌓인다.

**플러그인 스킬은 설치 없이도 측정된다 (Claude Code 런타임).** 격리 레코딩이 해석된 사본을
`--plugin-dir` 로 직접 로드한다. 개인 스킬(`~/.claude/skills`)과 Codex 런타임은 예전대로
세션에 설치·리로드되어 있어야 한다 — 없으면 발동률 0%는 description 결함이 아니라 후보
목록에 없어서다.

**격리는 하네스가 하고, 변형마다 환경이 다르다 (Claude Code 런타임).** 레코딩은 실행마다
새 빈 임시 디렉터리에서 유저 스코프를 제외하고 돈다 — 전역 플러그인의 스킬·훅과 CLAUDE.md
가 턴을 뺏던 오염(실측: 트리거 실패 10건 중 9건) 제거. 트리거(`with`)는 대상 플러그인을
싣고 정찰 1턴을 허용하며(2턴), 실험군(`forced`)은 SKILL.md 본문을 프롬프트에 주입하고
`--add-dir` 로 참조 파일 접근을 보장하며, 대조군(`without`)은 플러그인을 아예 싣지 않는다.
`SKILL_EVAL_ALLOW_SIDE_EFFECTS=1` 은 인자 격리만 끄고 cwd 격리는 유지한다. Codex 런타임은
격리 미지원.

**예산 상한이 없다.** 케이스 5~7건 한 번 측정이 대략 \$2.6~4.6이다. 리포트의 `비용` 줄에
실제 지출이 찍힌다.

**판정은 합격·불합격·판정 불가 세 상태다.** 판정 불가는 통과가 아니라 측정이 성립하지
않았다는 뜻이다 — 사유를 없앤 뒤 다시 돌려야 점수가 의미를 갖는다.

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
