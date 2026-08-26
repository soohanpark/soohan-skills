import { makeExec, type Exec, type SkillRef, type Variant } from './claude.js'

// 검증 결과 (2026-07-24, codex-cli 0.145.0):
// - `codex exec --json`은 스킬 발동을 알리는 전용 이벤트가 없다. Codex는 스킬을
//   전용 툴이 아니라 셸 명령(sed/cat)으로 SKILL.md를 직접 읽어 "발동"한다 — 즉 Claude의
//   skillReadFallback과 같은 메커니즘이 유일한 신호다(parse.ts의 parseCodexStream 참고).
// - forced 변형에 쓸 슬래시 커맨드 같은 것도 없다. 스킬 이름을 자연어로 지목하는 것이
//   유일한 레버다.
// - CODEX_HOME을 임시 디렉터리로 돌리면 auth.json이 함께 빠져 인증이 끊긴다
//   (실측: wss 401 Unauthorized). 그래서 without 변형은 지원하지 않는다.
export const buildCodexArgs = (variant: Variant, skill: SkillRef, prompt: string): string[] => {
  if (variant === 'without') {
    throw new Error(
      'Codex의 without 변형은 지원하지 않습니다: CODEX_HOME을 임시 디렉터리로 돌리면 ' +
      'auth.json이 함께 빠져 인증이 끊깁니다(실측 2026-07-24, wss 401 Unauthorized). ' +
      "Codex에서는 'with'/'forced' 축만 측정하세요."
    )
  }

  const base = ['exec', '--json', '--skip-git-repo-check', '--ephemeral']
  if (variant === 'forced') return [...base, `${skill.id} 스킬을 사용해서 처리해줘.\n\n${prompt}`]
  return [...base, prompt]
}

// execClaude와 같은 계약(makeExec): exit code만으로 성공/실패를 가르지 않고, stdout이
// 통째로 비어 있을 때만 실패로 올린다 — turn.completed 유무는 parseCodexStream이 분류한다.
export const execCodex: Exec = makeExec('codex')
