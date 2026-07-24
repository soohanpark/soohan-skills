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
})
