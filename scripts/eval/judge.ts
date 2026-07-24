import type { EvalCase } from './cases.js'

export type Verdict = 'A' | 'B' | 'tie'

export const deriveCriteria = (c: EvalCase, skillDescription: string): string =>
  c.criteria ?? `다음이 이 작업에서 약속된 것이다: ${skillDescription}`

export const buildJudgePrompt = (args: { criteria: string; a: string; b: string }): string => `
아래 두 출력을 주어진 기준으로만 비교하라. 기준 밖의 요소(친절함, 길이, 어조 등)는 판단에 넣지 마라.

## 기준
${args.criteria}

## 출력 A
${args.a}

## 출력 B
${args.b}

## 응답 형식
아래 JSON만 출력하라. 우열을 가릴 수 없으면 tie 로 답하라.
{"verdict":"A"|"B"|"tie","rationale":"기준에 비추어 판단한 근거 한 문장"}
`.trim()

const JSON_BLOCK = /\{[^{}]*"verdict"[^{}]*\}/

export const parseVerdict = (raw: string): { verdict: Verdict; rationale: string } => {
  const m = JSON_BLOCK.exec(raw)
  if (!m) return { verdict: 'tie', rationale: '' }
  try {
    const parsed = JSON.parse(m[0])
    const v = parsed.verdict
    if (v !== 'A' && v !== 'B' && v !== 'tie') return { verdict: 'tie', rationale: '' }
    return { verdict: v, rationale: String(parsed.rationale ?? '') }
  } catch {
    return { verdict: 'tie', rationale: '' }
  }
}

const tokens = (s: string): string[] =>
  s.toLowerCase().split(/[^0-9a-z가-힣]+/).filter(t => t.length >= 2)

// 근거가 기준과 어휘를 하나도 공유하지 않으면 심판이 제 기준을 지어낸 것이다 (설계 §8-2)
export const isRationaleOnTopic = (rationale: string, criteria: string): boolean => {
  if (rationale.trim() === '') return false
  const criteriaTokens = new Set(tokens(criteria))
  return tokens(rationale).some(t => criteriaTokens.has(t))
}

// 1회차는 forced 가 A, 2회차는 순서를 뒤집어 forced 가 B 에 놓인다.
export const resolvePair = (first: Verdict, flipped: Verdict): 'skill' | 'baseline' | 'tie' => {
  if (first === 'A' && flipped === 'B') return 'skill'
  if (first === 'B' && flipped === 'A') return 'baseline'
  return 'tie'
}

// 같은 출력을 A/B 양쪽에 넣고 물었을 때의 응답으로 심판을 검증한다 (설계 §7-2).
// 무승부가 아니면 위치·표현에 흔들리는 심판이므로 정성 판정 전체를 신뢰할 수 없다.
// 근거 없는 tie 는 파싱 실패의 기본값이므로 통과시키지 않는다.
export const isJudgeTrustworthy = (sanity: { verdict: Verdict; rationale: string }): boolean =>
  sanity.verdict === 'tie' && sanity.rationale.trim() !== ''

export type PairOutcome = 'skill' | 'baseline' | 'tie'

export interface PairResult {
  caseId: string
  split: 'train' | 'test'
  outcome: PairOutcome
  discarded: boolean
}

export interface PairwiseScore {
  win: number
  loss: number
  tie: number
  discarded: number
  rate: number | null   // 무승부를 제외한 승률. 결정된 쌍이 없으면 null
}

// 트리거·규칙 축과 동일하게 test split 에서만 합격/불합격 게이트를 가른다 (설계 §7-3).
// train 쌍은 verdicts 파일의 results[] 에는 그대로 남아 사람이 보되, 여기 집계에는 들어오지 않는다.
export const scorePairwise = (results: PairResult[]): PairwiseScore => {
  const testResults = results.filter(r => r.split === 'test')
  const kept = testResults.filter(r => !r.discarded)
  const win = kept.filter(r => r.outcome === 'skill').length
  const loss = kept.filter(r => r.outcome === 'baseline').length
  const tie = kept.filter(r => r.outcome === 'tie').length
  const decided = win + loss

  return {
    win, loss, tie,
    discarded: testResults.length - kept.length,
    rate: decided === 0 ? null : win / decided
  }
}
