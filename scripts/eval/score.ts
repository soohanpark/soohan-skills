import type { EvalCase } from './cases.js'
import type { IndexEntry } from './record.js'
import { checkRules } from './rules.js'

export interface SplitScore {
  positive: { hit: number; total: number }
  negative: { falseHit: number; total: number }
  unstable: string[]
  nError: number
}

export interface TriggerScore {
  train: SplitScore
  test: SplitScore
}

export interface Failure {
  caseId: string
  kind: '오발동' | '미발동' | 'must' | 'timeout' | 'error'
  detail: string
}

const emptySplit = (): SplitScore => ({
  positive: { hit: 0, total: 0 },
  negative: { falseHit: 0, total: 0 },
  unstable: [],
  nError: 0
})

const triggerRunsFor = (index: IndexEntry[], caseId: string) =>
  index.filter(e => e.variant === 'with' && e.caseId === caseId)

// Task 5 리뷰 이월: scoreTrigger와 collectFailures가 "ok 필터 → 2:1 다수결" 계산을
// 각자 베껴 썼다 — 텍스트가 같아서 우연히 일치했을 뿐이라 규칙이 바뀌면 조용히 어긋날 수 있었다.
const okRuns = (runs: IndexEntry[]): IndexEntry[] => runs.filter(r => r.parsed.status === 'ok')
const firedCount = (ok: IndexEntry[]): number => ok.filter(r => r.parsed.triggered).length
const firedMajority = (fired: number, ok: IndexEntry[]): boolean => fired * 2 > ok.length

export const scoreTrigger = (index: IndexEntry[], cases: EvalCase[]): TriggerScore => {
  const score: TriggerScore = { train: emptySplit(), test: emptySplit() }

  for (const c of cases) {
    const runs = triggerRunsFor(index, c.id)
    if (runs.length === 0) continue

    const bucket = score[c.split]
    const ok = okRuns(runs)
    bucket.nError += runs.length - ok.length
    if (ok.length === 0) continue // 전부 에러 — 판정 불가, 분모에서 제외 (설계 §10)

    const fired = firedCount(ok)
    if (fired > 0 && fired < ok.length) bucket.unstable.push(c.id)

    const majority = firedMajority(fired, ok)
    if (c.expect === 'trigger') {
      bucket.positive.total += 1
      if (majority) bucket.positive.hit += 1
    } else {
      bucket.negative.total += 1
      if (majority) bucket.negative.falseHit += 1
    }
  }

  return score
}

export const collectFailures = (index: IndexEntry[], cases: EvalCase[]): Failure[] => {
  const failures: Failure[] = []

  for (const c of cases) {
    const runs = triggerRunsFor(index, c.id)
    if (runs.length === 0) continue

    const ok = okRuns(runs)
    const errored = runs.filter(r => r.parsed.status !== 'ok')

    if (errored.length > 0) {
      const detail = ok.length === 0
        ? errored[0].parsed.terminalReason
        : `${errored[0].parsed.terminalReason} (${errored.length}/${runs.length})`
      failures.push({ caseId: c.id, kind: 'error', detail })
    }
    if (ok.length === 0) continue // 전부 에러 — 판정 불가, scoreTrigger와 동일 기준 (설계 §10)

    const fired = firedCount(ok)
    const majority = firedMajority(fired, ok)
    if (c.expect === 'trigger' && !majority) {
      failures.push({ caseId: c.id, kind: '미발동', detail: c.prompt })
    }
    if (c.expect === 'no-trigger' && majority) {
      failures.push({ caseId: c.id, kind: '오발동', detail: c.prompt })
    }
  }

  return failures
}

// forced 변형은 반복하지 않으므로 다수결이 필요 없다 — case당 forced 실행이 정상 종료했는지만 본다
// (실행 에러는 트리거 축과 같은 원칙으로 품질 실패가 아니라 판정 불가로 분모에서 제외한다).
export const scoreRules = (
  index: IndexEntry[],
  cases: EvalCase[]
): { pass: number; total: number; failures: Failure[] } => {
  let pass = 0
  let total = 0
  const failures: Failure[] = []

  for (const c of cases) {
    if (!c.must && !c.must_not) continue
    const run = index.find(e => e.variant === 'forced' && e.caseId === c.id)
    if (!run || run.parsed.status !== 'ok') continue

    total += 1
    const r = checkRules(run.parsed.finalText, c)
    if (r.passed) pass += 1
    else failures.push({ caseId: c.id, kind: 'must', detail: r.failures.join(', ') })
  }

  return { pass, total, failures }
}
