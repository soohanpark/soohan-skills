export type RunStatus = 'ok' | 'error' | 'timeout'

export interface ParsedRun {
  triggered: boolean
  skillReadFallback: boolean
  finalText: string
  status: RunStatus
  terminalReason: string
  tokens: number
  costUsd: number
  model: string
  loadedSkills: string[]
}

interface ParseOptions {
  skillId: string
  skillDir: string
}

// max_turns 는 트리거 축이 --max-turns 1 로 일부러 자른 결과이므로 정상 종료로 본다.
const OK_TERMINAL_REASONS = new Set(['success', 'max_turns', 'stop_sequence'])

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
        if (block.name === 'Read' && typeof block.input?.file_path === 'string') {
          const filePath = block.input.file_path
          // ponytail: require path separator to avoid prefix collisions (e.g. 'write' vs 'write-v2')
          if (filePath === opts.skillDir || filePath.startsWith(opts.skillDir + '/')) {
            skillReadFallback = true
          }
        }
      }
      continue
    }

    if (ev.type === 'result') result = ev
  }

  if (!result) {
    return {
      triggered, skillReadFallback, finalText,
      status: 'error', terminalReason: 'no_result_event',
      tokens: 0, costUsd: 0, model, loadedSkills
    }
  }

  const terminalReason = result.terminal_reason ?? 'unknown'
  const status: RunStatus = OK_TERMINAL_REASONS.has(terminalReason) ? 'ok' : 'error'
  const usage = result.usage ?? {}
  const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)

  return {
    triggered,
    skillReadFallback,
    finalText: typeof result.result === 'string' && result.result ? result.result : finalText,
    status,
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

  const skillDirName = opts.skillDir.split('/').filter(Boolean).pop() ?? ''
  const codexSkillName = opts.skillId.split(':')[0]

  for (const ev of events) {
    if (ev.type === DONE_EVENT) { done = ev; continue }

    const item = ev.item
    if (!item) continue

    if (item.type === 'command_execution' && typeof item.command === 'string') {
      const cmd: string = item.command
      // ponytail: Codex가 절대경로/레포 상대경로/~/.codex/skills 심링크 중 무엇으로
      // SKILL.md를 읽는지 실행마다 다를 수 있어, skillDir의 마지막 세그먼트(내부 스킬명)
      // 또는 plugin 이름 중 하나가 "…/SKILL.md" 바로 앞에 오면 발동으로 본다.
      if (cmd.includes('SKILL.md') &&
          (cmd.includes(`${skillDirName}/SKILL.md`) || cmd.includes(`${codexSkillName}/SKILL.md`))) {
        triggered = true
      }
    }

    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      finalText = item.text
    }
  }

  if (!done) {
    return {
      triggered, skillReadFallback: false, finalText,
      status: 'error', terminalReason: 'no_completion_event',
      tokens: 0, costUsd: 0, model: '', loadedSkills: []
    }
  }

  const usage = done.usage ?? {}
  return {
    triggered,
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
