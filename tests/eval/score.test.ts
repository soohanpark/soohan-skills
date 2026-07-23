import { describe, it, expect } from 'vitest'
import { scoreTrigger, collectFailures } from '../../scripts/eval/score'
import type { EvalCase } from '../../scripts/eval/cases'
import type { IndexEntry } from '../../scripts/eval/record'

const parsed = (over: Partial<IndexEntry['parsed']> = {}) => ({
  triggered: false, skillReadFallback: false, finalText: '',
  status: 'ok' as const, terminalReason: 'success', tokens: 0, costUsd: 0,
  model: 'm', loadedSkills: [], ...over
})

const entry = (caseId: string, repeat: number, over: Partial<IndexEntry['parsed']> = {}): IndexEntry => ({
  caseId, variant: 'with', repeat, file: `with--${caseId}--r${repeat}.jsonl`,
  durationMs: 1, parsed: parsed(over)
})

const cases: EvalCase[] = [
  { id: 'p1', prompt: 'x', expect: 'trigger', split: 'test' },
  { id: 'n1', prompt: 'y', expect: 'no-trigger', split: 'test' },
  { id: 'p2', prompt: 'z', expect: 'trigger', split: 'train' }
]

describe('scoreTrigger', () => {
  it('counts a positive as a hit when the majority of repeats triggered', () => {
    const index = [entry('p1', 1, { triggered: true }), entry('p1', 2, { triggered: true }), entry('p1', 3)]
    const s = scoreTrigger(index, cases)
    expect(s.test.positive).toEqual({ hit: 1, total: 1 })
  })

  it('counts a negative as a false hit when the majority triggered', () => {
    const index = [entry('n1', 1, { triggered: true }), entry('n1', 2, { triggered: true })]
    const s = scoreTrigger(index, cases)
    expect(s.test.negative).toEqual({ falseHit: 1, total: 1 })
  })

  it('separates train and test splits', () => {
    const index = [entry('p1', 1, { triggered: true }), entry('p2', 1, { triggered: true })]
    const s = scoreTrigger(index, cases)
    expect(s.test.positive.total).toBe(1)
    expect(s.train.positive.total).toBe(1)
  })

  it('marks a case unstable when repeats disagree', () => {
    const index = [entry('p1', 1, { triggered: true }), entry('p1', 2, { triggered: true }), entry('p1', 3)]
    const s = scoreTrigger(index, cases)
    expect(s.test.unstable).toEqual(['p1'])
  })

  it('excludes error runs from the denominator instead of counting them as non-triggers', () => {
    const index = [
      entry('p1', 1, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 2, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 3, { triggered: true })
    ]
    const s = scoreTrigger(index, cases)
    expect(s.test.positive).toEqual({ hit: 1, total: 1 })
    expect(s.test.nError).toBe(2)
  })

  it('drops a case entirely when every repeat errored', () => {
    const index = [entry('p1', 1, { status: 'error' }), entry('p1', 2, { status: 'error' })]
    const s = scoreTrigger(index, cases)
    expect(s.test.positive.total).toBe(0)
    expect(s.test.nError).toBe(2)
  })

  it('ignores non-with variants', () => {
    const index: IndexEntry[] = [{ ...entry('p1', 1, { triggered: true }), variant: 'without' }]
    const s = scoreTrigger(index, cases)
    expect(s.test.positive.total).toBe(0)
  })
})

describe('collectFailures', () => {
  it('reports a negative that triggered as 오발동', () => {
    const f = collectFailures([entry('n1', 1, { triggered: true })], cases)
    expect(f).toEqual([{ caseId: 'n1', kind: '오발동', detail: 'y' }])
  })

  it('reports a positive that never triggered as 미발동', () => {
    const f = collectFailures([entry('p1', 1)], cases)
    expect(f[0].kind).toBe('미발동')
  })

  it('reports errored runs with the terminal reason', () => {
    const f = collectFailures([entry('p1', 1, { status: 'error', terminalReason: 'api_error' })], cases)
    expect(f[0].kind).toBe('error')
    expect(f[0].detail).toBe('api_error')
  })

  it('returns [] when everything behaved', () => {
    const f = collectFailures([entry('p1', 1, { triggered: true }), entry('n1', 1)], cases)
    expect(f).toEqual([])
  })
})
