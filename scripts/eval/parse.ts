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
        if (block.name === 'Read' && typeof block.input?.file_path === 'string'
            && block.input.file_path.startsWith(opts.skillDir)) {
          skillReadFallback = true
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
