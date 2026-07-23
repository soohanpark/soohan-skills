import type { EvalCase } from './cases.js'
import type { IndexEntry } from './record.js'

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

export const scoreTrigger = (index: IndexEntry[], cases: EvalCase[]): TriggerScore => {
  const score: TriggerScore = { train: emptySplit(), test: emptySplit() }

  for (const c of cases) {
    const runs = triggerRunsFor(index, c.id)
    if (runs.length === 0) continue

    const bucket = score[c.split]
    const ok = runs.filter(r => r.parsed.status === 'ok')
    bucket.nError += runs.length - ok.length
    if (ok.length === 0) continue // 전부 에러 — 판정 불가, 분모에서 제외 (설계 §10)

    const fired = ok.filter(r => r.parsed.triggered).length
    if (fired > 0 && fired < ok.length) bucket.unstable.push(c.id)

    const majority = fired * 2 > ok.length
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

    const errored = runs.find(r => r.parsed.status !== 'ok')
    if (errored) {
      failures.push({ caseId: c.id, kind: 'error', detail: errored.parsed.terminalReason })
      continue
    }

    const fired = runs.filter(r => r.parsed.triggered).length
    const majority = fired * 2 > runs.length
    if (c.expect === 'trigger' && !majority) {
      failures.push({ caseId: c.id, kind: '미발동', detail: c.prompt })
    }
    if (c.expect === 'no-trigger' && majority) {
      failures.push({ caseId: c.id, kind: '오발동', detail: c.prompt })
    }
  }

  return failures
}
