import type { EvalCase } from './cases.js'

export type Verdict = 'A' | 'B' | 'tie'

export const deriveCriteria = (c: EvalCase, skillDescription: string): string =>
  c.criteria ?? `다음이 이 작업에서 약속된 것이다: ${skillDescription}`

// SKILL.md frontmatter 에서 description 값만 꺼낸다 — name: 같은 메타데이터가 기준에 섞이면
// isRationaleOnTopic 의 어휘 검사가 그 잡음과의 겹침도 인정하게 된다 (설계 §8-2).
// 접힌/리터럴 YAML 블록(>-, |)도 읽는다. 이 레포는 단일 라인 규약이지만 측정 대상은 외부
// 스킬이고 그쪽은 블록 형태를 흔히 쓴다.
// 못 찾으면 빈 문자열이다. 폴백으로 프론트매터 전체를 돌려주면 바로 위 주석이 금지한 그 동작이
// 된다 — 메타데이터가 심판 기준이 되고, 그 잡음과의 어휘 겹침만으로 근거가 on-topic 판정을 받아
// 폐기 필터가 무력화된다. 호출부가 빈 값을 보고 멈추는 편이 낫다.
// 블록 형태를 먼저 본다 — 단일 라인 패턴을 먼저 대면 "description: >-" 의 ">-" 자체를
// 값으로 집어간다 ([ \t]* 가 0글자로 물러나면서 negative lookahead 를 비껴간다).
const BLOCK = /^description:[ \t]*[|>][-+]?[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m
const SINGLE_LINE = /^description:[ \t]*(.+)$/m
const BLOCK_INDICATOR_ONLY = /^[|>][-+]?$/

export const skillDescription = (skillMd: string): string => {
  const frontmatter = skillMd.split('---')[1] ?? ''
  const block = BLOCK.exec(frontmatter)
  if (block) return block[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ')

  const single = SINGLE_LINE.exec(frontmatter)
  if (!single) return ''
  const value = single[1].trim().replace(/^(['"])(.*)\1$/, '$2')
  // 들여쓴 본문이 없는 깨진 블록 선언 — 값이 아니다
  return BLOCK_INDICATOR_ONLY.test(value) ? '' : value
}

// 심판 호출은 한 턴짜리 텍스트 응답이다 — 도구가 필요 없다. 프롬프트에 녹화 트랜스크립트
// (신뢰 불가 입력)가 들어가므로 턴과 도구를 함께 잠근다. 턴 초과로 잘리면 parseVerdict 가
// tie 로 안전하게 폴백한다 (설계 §8-2, 리뷰 R7).
export const buildJudgeArgs = (prompt: string): string[] => [
  '-p', prompt, '--output-format', 'stream-json', '--verbose',
  '--max-turns', '1',
  '--disallowedTools', 'Skill', 'Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'WebFetch', 'WebSearch'
]

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

// boolean 으로는 "검사했고 통과" 와 "검사 자체를 안 함" 이 구분되지 않는다. 실제로 forced 가
// 전부 error 였던 실행에서 자가진단 블록이 통째로 건너뛰어지고 초기값 true 가 그대로 파일에
// 박혔다 — 아무 검증도 안 한 상태가 '신뢰함'으로 표시됐다 (외부 실측 보고 2026-07-28).
export type JudgeCheck = 'trusted' | 'untrusted' | 'unchecked'

// 구 verdict 파일은 boolean 이었다. true 는 두 상태가 섞인 값이므로 'trusted' 로 낙관하지 않고
// 'unchecked' 로 내린다 — 옛 실행을 다시 채점해도 없던 신뢰가 생기지는 않는다.
export const readJudgeCheck = (data: { judgeCheck?: unknown; judgeTrustworthy?: unknown }): JudgeCheck => {
  if (data.judgeCheck === 'trusted' || data.judgeCheck === 'untrusted' || data.judgeCheck === 'unchecked') {
    return data.judgeCheck
  }
  return data.judgeTrustworthy === false ? 'untrusted' : 'unchecked'
}

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
