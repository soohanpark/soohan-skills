import { describe, it, expect } from 'vitest'
import { formatReport, pct, verdict } from '../../scripts/eval/report'
import type { TriggerScore } from '../../scripts/eval/score'

const score: TriggerScore = {
  train: { positive: { hit: 18, total: 20 }, negative: { falseHit: 0, total: 15 }, unstable: ['x'], nError: 0 },
  test: { positive: { hit: 12, total: 13 }, negative: { falseHit: 1, total: 12 }, unstable: ['y', 'z'], nError: 1 }
}

const meta = {
  runId: '2026-07-23T14-02', skillId: 'demo:write', model: 'claude-opus-4-8',
  judgeModel: null, loadedSkills: new Array(77).fill('s'), repoSha: 'abc1234',
  casesHash: 'abc123', startedAt: '2026-07-23T14:02:00.000Z', degradedBaseline: false
}

describe('pct', () => {
  it('formats a ratio as a rounded percentage', () => {
    expect(pct(12, 13)).toBe('92%')
  })

  it('returns a dash when the denominator is zero', () => {
    expect(pct(0, 0)).toBe('—')
  })
})

describe('verdict', () => {
  it('passes when positives are at least 90% and false hits at most 10%', () => {
    expect(verdict(score).passed).toBe(true)
  })

  it('fails and names the metric when the positive rate is too low', () => {
    const low = { ...score, test: { ...score.test, positive: { hit: 5, total: 13 } } }
    const v = verdict(low)
    expect(v.passed).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/발동률/)
  })

  it('fails when the false trigger rate is too high', () => {
    const bad = { ...score, test: { ...score.test, negative: { falseHit: 6, total: 12 } } }
    expect(verdict(bad).passed).toBe(false)
  })

  it('ignores the rules gate when no rules were scored (total 0)', () => {
    expect(verdict(score, { pass: 0, total: 0 }).passed).toBe(true)
  })

  it('passes when the must/must_not pass rate is at least 90%', () => {
    expect(verdict(score, { pass: 9, total: 10 }).passed).toBe(true)
  })

  it('fails and names must/must_not when the rule pass rate is too low', () => {
    const v = verdict(score, { pass: 5, total: 10 })
    expect(v.passed).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/must\/must_not/)
  })
})

describe('formatReport', () => {
  it('shows both splits, the competing skill count and the error count', () => {
    const out = formatReport({ meta, score, failures: [] })
    expect(out).toContain('demo:write')
    expect(out).toContain('경쟁 스킬 77개')
    expect(out).toContain('92%')
    expect(out).toContain('unstable')
    expect(out).toContain('1건')  // nError
  })

  it('lists failures with their kind', () => {
    const out = formatReport({
      meta, score,
      failures: [{ caseId: 'n-003', kind: '오발동', detail: '커밋 로그 정리해줘' }]
    })
    expect(out).toContain('n-003')
    expect(out).toContain('오발동')
  })

  it('warns when the baseline was degraded and baseline runs actually happened', () => {
    const out = formatReport({ meta: { ...meta, degradedBaseline: true }, score, failures: [], hasBaselineRuns: true })
    expect(out).toContain('baseline 저하')
  })

  it('does not warn about a degraded baseline when no baseline runs happened', () => {
    const out = formatReport({ meta: { ...meta, degradedBaseline: true }, score, failures: [] })
    expect(out).not.toContain('baseline 저하')
  })

  it('adds a 품질 section with the must/must_not pass rate when rules were scored', () => {
    const out = formatReport({ meta, score, failures: [], rules: { pass: 9, total: 10 } })
    expect(out).toContain('품질')
    expect(out).toContain('9/10')
    expect(out).toContain('90%')
  })

  it('omits the 품질 section when no rules were passed in', () => {
    const out = formatReport({ meta, score, failures: [] })
    expect(out).not.toContain('품질')
  })

  it('omits the 품질 section when rules total is zero', () => {
    const out = formatReport({ meta, score, failures: [], rules: { pass: 0, total: 0 } })
    expect(out).not.toContain('품질')
  })
})
