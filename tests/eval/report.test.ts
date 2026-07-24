import { describe, it, expect } from 'vitest'
import { formatDiff, formatReport, formatTokenCount, pct, verdict } from '../../scripts/eval/report'
import type { TriggerScore } from '../../scripts/eval/score'
import type { PairwiseScore } from '../../scripts/eval/judge'
import type { RunMeta } from '../../scripts/eval/record'

const score: TriggerScore = {
  train: { positive: { hit: 18, total: 20 }, negative: { falseHit: 0, total: 15 }, unstable: ['x'], nError: 0 },
  test: { positive: { hit: 12, total: 13 }, negative: { falseHit: 1, total: 12 }, unstable: ['y', 'z'], nError: 1 }
}

const meta: RunMeta = {
  runId: '2026-07-23T14-02', skillId: 'demo:write', skillDir: '/tmp/plugins/demo/skills/write', model: 'claude-opus-4-8',
  judgeModel: null, loadedSkills: new Array(77).fill('s'), repoSha: 'abc1234',
  casesHash: 'abc123', startedAt: '2026-07-23T14:02:00.000Z', degradedBaseline: false,
  runtime: 'claude'
}

const pairwise: PairwiseScore = { win: 5, loss: 0, tie: 1, discarded: 0, rate: 1 }

describe('pct', () => {
  it('formats a ratio as a rounded percentage', () => {
    expect(pct(12, 13)).toBe('92%')
  })

  it('returns a dash when the denominator is zero', () => {
    expect(pct(0, 0)).toBe('—')
  })
})

describe('formatTokenCount', () => {
  it('formats thousands with one decimal and a k suffix', () => {
    expect(formatTokenCount(4200)).toBe('4.2k')
    expect(formatTokenCount(3100)).toBe('3.1k')
  })

  it('leaves sub-1000 counts as plain integers', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(0)).toBe('0')
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

describe('verdict with pairwise', () => {
  it('passes when the skill wins at least 60% of decided pairs', () => {
    expect(verdict(score, undefined, pairwise).passed).toBe(true)
  })

  it('fails when the win rate is near chance', () => {
    const coin: PairwiseScore = { win: 3, loss: 3, tie: 0, discarded: 0, rate: 0.5 }
    const v = verdict(score, undefined, coin)
    expect(v.passed).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/존재 의미/)
  })

  it('ignores pairwise entirely when no pair was decided', () => {
    const none: PairwiseScore = { win: 0, loss: 0, tie: 2, discarded: 0, rate: null }
    expect(verdict(score, undefined, none).passed).toBe(true)
  })
})

describe('verdict with judgeTrustworthy', () => {
  const losing: PairwiseScore = { win: 1, loss: 5, tie: 0, discarded: 0, rate: 1 / 6 }

  it('does not add a pairwise-driven fail reason when the judge failed its self-check', () => {
    const v = verdict(score, undefined, losing, false)
    expect(v.passed).toBe(true)
    expect(v.reasons.join(' ')).not.toMatch(/존재 의미/)
  })

  it('still applies the pairwise threshold when judgeTrustworthy is explicitly true', () => {
    const v = verdict(score, undefined, losing, true)
    expect(v.passed).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/존재 의미/)
  })

  it('still applies the pairwise threshold when judgeTrustworthy is omitted', () => {
    const v = verdict(score, undefined, losing)
    expect(v.passed).toBe(false)
  })
})

describe('formatReport with pairwise', () => {
  it('shows the win/tie/loss line', () => {
    const out = formatReport({ meta, score, failures: [], pairwise })
    expect(out).toContain('5승 1무 0패')
  })

  it('shows a dash for the rate when every pair tied', () => {
    const none: PairwiseScore = { win: 0, loss: 0, tie: 6, discarded: 0, rate: null }
    const out = formatReport({ meta, score, failures: [], pairwise: none })
    expect(out).toContain('0승 6무 0패  —')
  })

  it('notes discarded off-topic verdicts when present', () => {
    const some: PairwiseScore = { win: 2, loss: 1, tie: 0, discarded: 3, rate: 2 / 3 }
    const out = formatReport({ meta, score, failures: [], pairwise: some })
    expect(out).toContain('기준 밖 근거로 폐기된 판정 3건')
  })
})

describe('formatReport with judgeTrustworthy', () => {
  it('warns when a pairwise result is present and the judge failed its self-check', () => {
    const out = formatReport({ meta, score, failures: [], pairwise, judgeTrustworthy: false })
    expect(out).toContain('심판 신뢰성')
  })

  it('does not warn when judgeTrustworthy is true with the same pairwise data', () => {
    const out = formatReport({ meta, score, failures: [], pairwise, judgeTrustworthy: true })
    expect(out).not.toContain('심판 신뢰성')
  })

  it('does not warn when judgeTrustworthy is omitted with the same pairwise data', () => {
    const out = formatReport({ meta, score, failures: [], pairwise })
    expect(out).not.toContain('심판 신뢰성')
  })
})

describe('formatReport with rules and pairwise together', () => {
  it('renders a single 품질 header with both the must/must_not and pairwise sub-lines', () => {
    const out = formatReport({ meta, score, failures: [], rules: { pass: 9, total: 10 }, pairwise })
    expect(out.match(/품질/g)?.length).toBe(1)
    expect(out).toContain('must/must_not')
    expect(out).toContain('9/10')
    expect(out).toContain('5승 1무 0패')
  })
})

describe('formatReport with tokens', () => {
  it('shows the token line with the forced/without split and the relative percent delta', () => {
    const out = formatReport({ meta, score, failures: [], tokens: { forced: 4200, without: 3100 } })
    expect(out).toContain('토큰')
    expect(out).toContain('4.2k')
    expect(out).toContain('3.1k')
    expect(out).toContain('+35%')
  })

  it('opens a 품질 section for tokens alone, even with no rules or pairwise', () => {
    const out = formatReport({ meta, score, failures: [], tokens: { forced: 4200, without: 3100 } })
    expect(out).toContain('품질')
  })

  it('omits the token line when tokens is not passed', () => {
    const out = formatReport({ meta, score, failures: [] })
    expect(out).not.toContain('토큰')
  })

  it('omits the token line when forced is zero', () => {
    const out = formatReport({ meta, score, failures: [], tokens: { forced: 0, without: 0 } })
    expect(out).not.toContain('토큰')
  })

  it('shows a dash for the percent when without is zero, but still shows the raw counts', () => {
    const out = formatReport({ meta, score, failures: [], tokens: { forced: 500, without: 0 } })
    expect(out).toContain('토큰')
    expect(out).toContain('500')
    expect(out).toMatch(/토큰[^\n]*—/)
  })
})

describe('formatDiff', () => {
  const before = {
    meta: { ...meta, runId: 'r1', loadedSkills: ['a', 'b'] },
    score: { ...score, test: { ...score.test, positive: { hit: 12, total: 13 } } }
  }
  const after = {
    meta: { ...meta, runId: 'r2', loadedSkills: ['a', 'b', 'c'] },
    score: { ...score, test: { ...score.test, positive: { hit: 9, total: 13 } } }
  }

  it('shows both run ids', () => {
    const out = formatDiff(before, after)
    expect(out).toContain('r1')
    expect(out).toContain('r2')
  })

  it('shows the signed delta of the positive rate', () => {
    expect(formatDiff(before, after)).toMatch(/-23%|-23 ?%/)
  })

  it('names skills that appeared between the two runs', () => {
    const out = formatDiff(before, after)
    expect(out).toContain('추가된 경쟁 스킬')
    expect(out).toContain('c')
  })

  it('names skills that disappeared', () => {
    const out = formatDiff(after, before)
    expect(out).toContain('사라진 경쟁 스킬')
    expect(out).toContain('c')
  })

  it('says the field was unchanged when the skill list is identical', () => {
    const out = formatDiff(before, { ...before, meta: { ...before.meta, runId: 'r3' } })
    expect(out).toContain('경쟁 스킬 변화 없음')
  })

  it('warns not to attribute the score change to the skill alone when competing skills changed', () => {
    const out = formatDiff(before, after)
    expect(out).toContain('스킬 변경 탓으로만 돌리지')
  })

  it('shows a dash instead of dividing by zero when the split is empty', () => {
    const emptyBefore = { ...before, score: { ...before.score, test: { ...before.score.test, positive: { hit: 0, total: 0 } } } }
    const out = formatDiff(emptyBefore, after)
    expect(out).toContain('—')
  })

  it('warns loudly and skips the competing-skill diff when the two runs used different runtimes', () => {
    const codexAfter = { ...after, meta: { ...after.meta, runtime: 'codex' as const, loadedSkills: [] } }
    const out = formatDiff(before, codexAfter)
    expect(out).toContain('⚠')
    expect(out).toContain('claude')
    expect(out).toContain('codex')
    expect(out).not.toContain('추가된 경쟁 스킬')
    expect(out).not.toContain('사라진 경쟁 스킬')
    expect(out).not.toContain('경쟁 스킬 변화 없음')
  })

  it('treats a run missing meta.runtime as claude, for pre-migration runs that predate the field', () => {
    const strip = (m: RunMeta): RunMeta => {
      const { runtime, ...rest } = m
      return rest as unknown as RunMeta
    }
    const legacyBefore = { ...before, meta: strip(before.meta) }
    const legacyAfter = { ...after, meta: strip(after.meta) }
    const out = formatDiff(legacyBefore, legacyAfter)
    expect(out).not.toContain('⚠ 서로 다른 런타임')
    expect(out).toContain('추가된 경쟁 스킬')
  })
})
