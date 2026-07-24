import { describe, it, expect } from 'vitest'
import { scoreTrigger, collectFailures, scoreRules } from '../../scripts/eval/score'
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

  it('reports both an error and a 미발동 when some repeats error but a surviving repeat did not trigger', () => {
    const index = [
      entry('p1', 1, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 2, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 3)
    ]
    const f = collectFailures(index, cases)
    const errorEntry = f.find(x => x.kind === 'error')
    expect(errorEntry).toBeDefined()
    expect(errorEntry?.detail).toContain('api_error')
    expect(errorEntry?.detail).toContain('2/3')
    expect(f.some(x => x.kind === '미발동')).toBe(true)
  })

  it('reports only the error (no 미발동) when the surviving repeat did trigger', () => {
    const index = [
      entry('p1', 1, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 2, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 3, { triggered: true })
    ]
    const f = collectFailures(index, cases)
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('error')
  })

  it('reports both an error and a 오발동 for a no-trigger case when a surviving repeat fired', () => {
    const index = [
      entry('n1', 1, { status: 'error', terminalReason: 'api_error' }),
      entry('n1', 2, { triggered: true })
    ]
    const f = collectFailures(index, cases)
    expect(f.some(x => x.kind === 'error')).toBe(true)
    expect(f.some(x => x.kind === '오발동')).toBe(true)
  })

  it('reports exactly one error and no trigger verdict when every repeat errored', () => {
    const index = [
      entry('p1', 1, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 2, { status: 'error', terminalReason: 'api_error' }),
      entry('p1', 3, { status: 'error', terminalReason: 'api_error' })
    ]
    const f = collectFailures(index, cases)
    expect(f).toHaveLength(1)
    expect(f[0]).toEqual({ caseId: 'p1', kind: 'error', detail: 'api_error' })
  })
})

describe('scoreRules', () => {
  const ruleCases: EvalCase[] = [
    { id: 'q1', prompt: 'x', expect: 'trigger', split: 'test', must: ['## 변경 사항'] },
    { id: 'q2', prompt: 'z', expect: 'trigger', split: 'test' }, // must/must_not 미선언 — 규칙 채점 대상 아님
    { id: 'q3', prompt: 'w', expect: 'trigger', split: 'train', must: ['## 변경 사항'] }
  ]

  const forced = (caseId: string, over: Partial<IndexEntry['parsed']> = {}): IndexEntry => ({
    ...entry(caseId, 1, over),
    variant: 'forced'
  })

  it('rule-scores only cases that declare must or must_not', () => {
    const index = [forced('q1', { finalText: '## 변경 사항\n내용' }), forced('q2', { finalText: '아무거나' })]
    const s = scoreRules(index, ruleCases)
    expect(s.test.total).toBe(1)
  })

  it('counts a pass when the forced output satisfies its rules', () => {
    const index = [forced('q1', { finalText: '## 변경 사항\n내용' })]
    const s = scoreRules(index, ruleCases)
    expect(s.test.pass).toBe(1)
    expect(s.failures).toEqual([])
  })

  it('reports a must-kind failure naming what failed', () => {
    const index = [forced('q1', { finalText: '엉뚱한 내용' })]
    const s = scoreRules(index, ruleCases)
    expect(s.test.pass).toBe(0)
    expect(s.failures).toEqual([{ caseId: 'q1', kind: 'must', detail: 'must 누락: "## 변경 사항"' }])
  })

  it('excludes an errored forced run from both pass and total, like the trigger axis', () => {
    const index = [forced('q1', { status: 'error', terminalReason: 'api_error' })]
    const s = scoreRules(index, ruleCases)
    expect(s.test.total).toBe(0)
    expect(s.test.pass).toBe(0)
    expect(s.failures).toEqual([])
  })

  it('excludes a case with no forced run at all', () => {
    const s = scoreRules([], ruleCases)
    expect(s).toEqual({ train: { pass: 0, total: 0 }, test: { pass: 0, total: 0 }, failures: [] })
  })

  it('ignores with/without runs for the same case id — only forced counts', () => {
    const index = [entry('q1', 1, { finalText: '## 변경 사항' })] // variant 'with'
    const s = scoreRules(index, ruleCases)
    expect(s.test.total).toBe(0)
  })

  it('keeps a train-split rule failure out of the test tally, though it still appears in failures', () => {
    const index = [forced('q3', { finalText: '엉뚱한 내용' })]
    const s = scoreRules(index, ruleCases)
    expect(s.train).toEqual({ pass: 0, total: 1 })
    expect(s.test).toEqual({ pass: 0, total: 0 })
    expect(s.failures).toEqual([{ caseId: 'q3', kind: 'must', detail: 'must 누락: "## 변경 사항"' }])
  })
})
