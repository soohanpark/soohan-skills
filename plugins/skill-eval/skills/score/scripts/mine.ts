import type { EvalCase } from './cases.js'

export interface MinedPrompt {
  prompt: string
  triggeredSkills: string[]
  sessionFile: string
}

const textFromContent = (content: unknown): string | null => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts = content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
  return parts.length > 0 ? parts.join('\n') : null
}

export const extractPrompts = (jsonl: string, sessionFile: string): MinedPrompt[] => {
  const out: MinedPrompt[] = []
  let current: MinedPrompt | null = null

  for (const line of jsonl.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue

    let ev: any
    try { ev = JSON.parse(t) } catch { continue }

    if (ev.type === 'user') {
      const text = textFromContent(ev.message?.content)
      if (text === null) continue
      current = { prompt: text, triggeredSkills: [], sessionFile }
      out.push(current)
      continue
    }

    if (ev.type === 'assistant' && current) {
      for (const block of ev.message?.content ?? []) {
        if (block?.type === 'tool_use' && block.name === 'Skill' && block.input?.skill) {
          current.triggeredSkills.push(block.input.skill)
        }
      }
    }
  }

  return out
}

const QUOTED = /"([^"]{2,60})"/g

export const keywordsFromDescription = (description: string): string[] => {
  const out: string[] = []
  for (const m of description.matchAll(QUOTED)) out.push(m[1])
  return out
}

export const classify = (
  mined: MinedPrompt[],
  args: { skillId: string; keywords: string[] }
): { positives: MinedPrompt[]; nearMisses: MinedPrompt[] } => {
  const positives: MinedPrompt[] = []
  const nearMisses: MinedPrompt[] = []
  const seen = new Set<string>()

  for (const m of mined) {
    if (seen.has(m.prompt)) continue
    seen.add(m.prompt)

    if (m.triggeredSkills.includes(args.skillId)) {
      positives.push(m)
      continue
    }
    // 키워드가 걸렸는데 발동하지 않은 것 = 모델이 실제로 망설인 지점 (설계 §6-2)
    if (args.keywords.some(k => m.prompt.includes(k))) nearMisses.push(m)
  }

  return { positives, nearMisses }
}

// 원본 단위로 3:1 분할한다. 변형을 붙일 때 같은 원본이 두 split 에 흩어지면 안 된다 (설계 §6-3)
const splitFor = (i: number): 'train' | 'test' => (i % 4 === 3 ? 'test' : 'train')

export const toDraftCases = (args: {
  positives: MinedPrompt[]
  nearMisses: MinedPrompt[]
}): EvalCase[] => {
  const cases: EvalCase[] = []

  args.positives.forEach((m, i) => {
    cases.push({
      id: `p-${String(i + 1).padStart(3, '0')}`,
      prompt: m.prompt,
      expect: 'trigger',
      split: splitFor(i),
      source: `log:${m.sessionFile}`
    })
  })

  args.nearMisses.forEach((m, i) => {
    cases.push({
      id: `n-${String(i + 1).padStart(3, '0')}`,
      prompt: m.prompt,
      expect: 'no-trigger',
      split: splitFor(i),
      source: `log:near-miss:${m.sessionFile}`
    })
  })

  return cases
}

export const buildAugmentPrompt = (prompt: string, n: number): string => `
아래 요청을 사용자가 다르게 말했을 법한 ${n}개의 표현으로 바꿔라.

## 원본
${prompt}

## 규칙
- 의도는 그대로 두고 표현만 바꾼다. 새로운 상황이나 새 시나리오를 만들지 마라.
- 존댓말/반말, 축약, 흔한 오타, 어순 변화 정도를 섞어라.
- 문자열 ${n}개가 든 JSON 배열만 출력하라. 다른 말은 붙이지 마라.
`.trim()

const ARRAY_BLOCK = /\[[\s\S]*?\]/

export const parseVariants = (raw: string): string[] => {
  const m = ARRAY_BLOCK.exec(raw)
  if (!m) return []
  try {
    const parsed = JSON.parse(m[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

// 변형은 원본의 split 과 expect 를 그대로 물려받는다.
// 같은 원본의 변형이 train 과 test 에 흩어지면 test 점수가 거짓으로 오른다 (설계 §6-3)
export const attachVariants = (original: EvalCase, variants: string[]): EvalCase[] =>
  variants.map((prompt, i) => ({
    id: `${original.id}-v${i + 1}`,
    prompt,
    expect: original.expect,
    split: original.split,
    source: `llm:variant-of:${original.id}`
  }))
