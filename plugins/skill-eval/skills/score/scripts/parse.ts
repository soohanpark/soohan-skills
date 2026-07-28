export type RunStatus = 'ok' | 'error' | 'timeout'

export interface ParsedRun {
  triggered: boolean
  truncated: boolean
  skillReadFallback: boolean
  finalText: string
  status: RunStatus
  terminalReason: string
  tokens: number
  costUsd: number
  model: string
  loadedSkills: string[]
}

export interface ParseOptions {
  skillId: string
  skillDir: string
}

// 실측(2026-07-28, claude-code 2.1.220)으로 확정한 result 이벤트 계약:
//   정상 완료   terminal_reason 'completed' · is_error false · subtype 'success'
//   턴 절단     terminal_reason 'max_turns' · is_error true  · subtype 'error_max_turns'
//   API 오류    terminal_reason 'api_error' · is_error true  · subtype 'success'  ← subtype 은 못 믿는다
// 그래서 성패는 is_error 로 가른다. 예외는 max_turns 하나뿐이다 — 트리거 축이 --max-turns 1 로
// 일부러 자른 결과라 "발동했는가"의 답으로는 유효하다. 대신 truncated 로 따로 표시해서
// 품질 축이 잘린 답변을 온전한 답변과 비교하지 않게 한다.
const TRUNCATED_REASON = 'max_turns'

// is_error 필드 자체가 없는 구버전 CLI 전용 폴백. 열거에 있던 'success' 는 subtype 값을 이 자리에
// 잘못 적은 것이었고 실제 CLI 는 낸 적이 없다 — 그 탓에 'completed' 가 빠져 정상 완료가 전부
// error 로 분류됐다 (외부 실측 보고 2026-07-28).
const LEGACY_OK_TERMINAL_REASONS = new Set(['completed', 'max_turns', 'stop_sequence'])

const classifyStatus = (result: Record<string, any>, terminalReason: string): RunStatus => {
  if (terminalReason === TRUNCATED_REASON) return 'ok'
  if (typeof result.is_error === 'boolean') return result.is_error ? 'error' : 'ok'
  return LEGACY_OK_TERMINAL_REASONS.has(terminalReason) ? 'ok' : 'error'
}

// SKILL.md 를 직접 읽는 우회를 잡는 패턴. 측정 대상 디렉터리와의 경로 전일치로는 못 잡는다 —
// 실행이 읽는 것은 대개 설치본이라 경로가 다르다 (실측 2026-07-28). 그래서 디렉터리 "이름"으로
// 잡는다: 레포 안 내부 스킬명, install.sh 가 쓰는 <plugin> 과 <plugin>-<skill> 셋 중 하나가
// "…/SKILL.md" 바로 앞 이름과 일치해야 한다. 앞에 경계 문자를 요구해 접미사 충돌(write-v2 vs write)을 막는다.
// 후보가 하나도 없으면 null 을 돌려준다 — 빈 교대(alternation)로 정규식을 만들면 모든 SKILL.md
// 언급에 매치해 버린다. judge·mine 이 skillId/skillDir 를 빈 문자열로 넘기므로 반드시 필요한 가드다.
export const skillReadPattern = (opts: ParseOptions): RegExp | null => {
  const skillDirName = opts.skillDir.split('/').filter(Boolean).pop() ?? ''
  const pluginName = opts.skillId.split(':')[0] ?? ''
  const candidates = [...new Set([skillDirName, pluginName, `${pluginName}-${skillDirName}`])]
    .filter(n => n !== '' && n !== '-')
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (candidates.length === 0) return null
  return new RegExp(`(^|[/'"\\s])(${candidates.join('|')})/SKILL\\.md`)
}

// 측정 대상 디렉터리 안의 파일인가. 빈 skillDir 로는 절대 매치시키지 않는다 —
// ''.length 때문에 startsWith(''+'/') 가 모든 절대경로에 참이 된다.
const insideSkillDir = (path: string, skillDir: string): boolean =>
  skillDir !== '' && (path === skillDir || path.startsWith(skillDir + '/'))

const readJsonLines = (raw: string): Record<string, any>[] => {
  const out: Record<string, any>[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      // CLI 경고나 잘린 줄 — 무시한다
    }
  }
  return out
}

export const parseClaudeStream = (raw: string, opts: ParseOptions): ParsedRun => {
  const events = readJsonLines(raw)
  const readPattern = skillReadPattern(opts)
  const namesSkillFile = (v: unknown): boolean =>
    typeof v === 'string' && readPattern !== null && readPattern.test(v)

  let triggered = false
  let skillReadFallback = false
  let finalText = ''
  let model = ''
  let loadedSkills: string[] = []
  let result: Record<string, any> | undefined

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      model = ev.model ?? ''
      loadedSkills = Array.isArray(ev.skills) ? ev.skills : []
      continue
    }

    if (ev.type === 'assistant') {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) {
          finalText = block.text
        }
        if (block.type !== 'tool_use') continue
        if (block.name === 'Skill' && block.input?.skill === opts.skillId) {
          triggered = true
        }
        // 우회 경로는 Read 하나가 아니다. Skill·Read 가 막히면 셸로 읽는다 — 실측에서 baseline 이
        // `cat …/SKILL.md` 를 16회 썼는데 플래그는 false 로 남았다 (2026-07-28).
        if (block.name === 'Read' && typeof block.input?.file_path === 'string') {
          const filePath = block.input.file_path
          // ponytail: require path separator to avoid prefix collisions (e.g. 'write' vs 'write-v2')
          if (insideSkillDir(filePath, opts.skillDir) || namesSkillFile(filePath)) {
            skillReadFallback = true
          }
        }
        if (block.name === 'Bash' && namesSkillFile(block.input?.command)) {
          skillReadFallback = true
        }
        if ((block.name === 'Grep' || block.name === 'Glob') &&
            (namesSkillFile(block.input?.pattern) ||
             namesSkillFile(block.input?.path) ||
             (typeof block.input?.path === 'string' && insideSkillDir(block.input.path, opts.skillDir)))) {
          skillReadFallback = true
        }
      }
      continue
    }

    if (ev.type === 'result') result = ev
  }

  if (!result) {
    return {
      triggered, truncated: false, skillReadFallback, finalText,
      status: 'error', terminalReason: 'no_result_event',
      tokens: 0, costUsd: 0, model, loadedSkills
    }
  }

  const terminalReason = result.terminal_reason ?? 'unknown'
  const usage = result.usage ?? {}
  // 실사용 컨텍스트 양이다. 캐시 토큰을 빼면 실사용량의 몇 %만 세게 된다 — 실측에서 사소한
  // 프롬프트조차 input+output 144 대 캐시 32,076 이었다 (2026-07-28). 다만 캐시 읽기는 단가가
  // 훨씬 싸므로 이 합계를 비용 대리값으로 쓰면 안 된다. 비용은 costUsd 를 따로 본다.
  const tokens =
    (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)

  return {
    triggered,
    truncated: terminalReason === TRUNCATED_REASON,
    skillReadFallback,
    finalText: typeof result.result === 'string' && result.result ? result.result : finalText,
    status: classifyStatus(result, terminalReason),
    terminalReason,
    tokens,
    costUsd: result.total_cost_usd ?? 0,
    model,
    loadedSkills
  }
}

// 검증 결과 (2026-07-24, codex-cli 0.145.0, `codex exec --json "블인팀 MR 내용 작성해줘"` 실측):
// - 최상위 이벤트: thread.started · turn.started · turn.completed · item.started · item.completed.
//   session_configured 는 없고 model 필드는 어디에도 안 나온다.
// - item.type: error(정보성 경고 포함 — 반드시 실패는 아니다) · agent_message · command_execution.
// - 스킬 전용 이벤트가 없다: Codex는 SKILL.md를 셸 명령(sed/cat)으로 직접 읽어 "발동"한다.
//   그 command_execution의 command 문자열이 스킬 발동을 식별하는 유일한 신호다.
const DONE_EVENT = 'turn.completed'

export const parseCodexStream = (raw: string, opts: ParseOptions): ParsedRun => {
  const events = readJsonLines(raw)

  let triggered = false
  let finalText = ''
  let done: Record<string, any> | undefined

  // Codex가 SKILL.md를 읽는 경로는 실행마다 다르다: 레포 상대경로(내부 스킬명 디렉터리),
  // install.sh 설치명(<plugin> 또는 다중 스킬이면 <plugin>-<skill>). 그 이름 판별은
  // claude 파서의 오염 탐지와 같은 규칙이라 skillReadPattern 하나로 공유한다.
  const skillReadRe = skillReadPattern(opts)

  for (const ev of events) {
    if (ev.type === DONE_EVENT) { done = ev; continue }

    const item = ev.item
    if (!item) continue

    if (item.type === 'command_execution' && typeof item.command === 'string' &&
        skillReadRe !== null && skillReadRe.test(item.command)) {
      triggered = true
    }

    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      finalText = item.text
    }
  }

  if (!done) {
    return {
      triggered, truncated: false, skillReadFallback: false, finalText,
      status: 'error', terminalReason: 'no_completion_event',
      tokens: 0, costUsd: 0, model: '', loadedSkills: []
    }
  }

  const usage = done.usage ?? {}
  return {
    triggered,
    truncated: false,           // Codex 이벤트에 턴 절단 신호가 없다 (실측)
    skillReadFallback: false,   // Codex는 SKILL.md를 읽는 것 자체가 유일한 발동 경로라 별도 우회 신호가 없다
    finalText,
    status: 'ok',
    terminalReason: 'completed',
    tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    costUsd: 0,   // Codex 이벤트에 비용 필드가 없다 (실측)
    model: '',    // Codex 이벤트에 모델 필드가 없다 (실측)
    loadedSkills: []
  }
}
