import { describe, it, expect } from 'vitest'
import { formatDiff, formatDuration, formatReport, formatTokenCount, pct, verdict } from '../../plugins/skill-eval/skills/score/scripts/report'
import type { TriggerScore } from '../../plugins/skill-eval/skills/score/scripts/score'
import type { PairwiseScore } from '../../plugins/skill-eval/skills/score/scripts/judge'
import type { RunMeta } from '../../plugins/skill-eval/skills/score/scripts/record'

const score: TriggerScore = {
  train: { positive: { hit: 18, total: 20 }, negative: { falseHit: 0, total: 15 }, unstable: ['x'], undecided: [], nError: 0 },
  test: { positive: { hit: 12, total: 13 }, negative: { falseHit: 1, total: 12 }, unstable: ['y', 'z'], undecided: [], nError: 1 }
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
    expect(verdict(score).status).toBe('pass')
  })

  it('fails and names the metric when the positive rate is too low', () => {
    const low = { ...score, test: { ...score.test, positive: { hit: 5, total: 13 } } }
    const v = verdict(low)
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toMatch(/발동률/)
  })

  it('fails when the false trigger rate is too high', () => {
    const bad = { ...score, test: { ...score.test, negative: { falseHit: 6, total: 12 } } }
    expect(verdict(bad).status).toBe('fail')
  })

  it('ignores the rules gate when no rules were scored (total 0)', () => {
    expect(verdict(score, { pass: 0, total: 0 }).status).toBe('pass')
  })

  it('passes when the must/must_not pass rate is at least 90%', () => {
    expect(verdict(score, { pass: 9, total: 10 }).status).toBe('pass')
  })

  it('fails and names must/must_not when the rule pass rate is too low', () => {
    const v = verdict(score, { pass: 5, total: 10 })
    expect(v.status).toBe('fail')
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
    expect(verdict(score, undefined, pairwise, 'trusted').status).toBe('pass')
  })

  it('fails when the win rate is near chance', () => {
    const coin: PairwiseScore = { win: 3, loss: 3, tie: 0, discarded: 0, rate: 0.5 }
    const v = verdict(score, undefined, coin, 'trusted')
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toMatch(/존재 의미/)
  })

  it('ignores pairwise entirely when no pair was decided', () => {
    const none: PairwiseScore = { win: 0, loss: 0, tie: 2, discarded: 0, rate: null }
    expect(verdict(score, undefined, none, 'trusted').status).toBe('pass')
  })
})

// 심판을 못 믿는데 합격을 찍으면, 판정 줄만 파싱하는 CI 는 통과로 읽는다. 정성 축을 재려다
// 실패한 실행은 합격도 불합격도 아니라 '판정 불가' 여야 한다.
describe('verdict with judgeCheck', () => {
  const losing: PairwiseScore = { win: 1, loss: 5, tie: 0, discarded: 0, rate: 1 / 6 }

  it('is undecidable — not a pass — when the judge failed its self-check', () => {
    const v = verdict(score, undefined, losing, 'untrusted')
    expect(v.status).toBe('undecidable')
    expect(v.reasons.join(' ')).toMatch(/통과하지 못해/)
    expect(v.reasons.join(' ')).not.toMatch(/존재 의미/)
  })

  it('is undecidable when the self-check never ran', () => {
    const v = verdict(score, undefined, losing, 'unchecked')
    expect(v.status).toBe('undecidable')
    expect(v.reasons.join(' ')).toMatch(/수행되지 않아/)
  })

  it('defaults to unchecked rather than assuming a trustworthy judge', () => {
    expect(verdict(score, undefined, losing).status).toBe('undecidable')
  })

  it('applies the pairwise threshold only once the judge is trusted', () => {
    const v = verdict(score, undefined, losing, 'trusted')
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toMatch(/존재 의미/)
  })

  it('stays quiet about the judge when there is no pairwise data at all', () => {
    expect(verdict(score, undefined, undefined, 'unchecked').status).toBe('pass')
  })
})

// split 을 안 적으면 test 분모가 전부 0이 되고, 게이트가 하나도 안 돌아 '✓ 합격' 이 찍혔다.
describe('verdict · 측정이 성립하지 않은 실행', () => {
  const emptyTest: TriggerScore = {
    train: { positive: { hit: 2, total: 3 }, negative: { falseHit: 0, total: 1 }, unstable: [], undecided: [], nError: 0 },
    test: { positive: { hit: 0, total: 0 }, negative: { falseHit: 0, total: 0 }, unstable: [], undecided: [], nError: 0 }
  }

  it('is undecidable when no gate could be evaluated', () => {
    const v = verdict(emptyTest)
    expect(v.status).toBe('undecidable')
    expect(v.reasons.join(' ')).toMatch(/split/)
  })

  it('is still undecidable when only train has numbers, however good they look', () => {
    const perfectTrain = { ...emptyTest, train: { ...emptyTest.train, positive: { hit: 3, total: 3 } } }
    expect(verdict(perfectTrain).status).toBe('undecidable')
  })

  it('becomes decidable as soon as one test gate has a denominator', () => {
    const oneGate = { ...emptyTest, test: { ...emptyTest.test, positive: { hit: 1, total: 1 } } }
    expect(verdict(oneGate).status).toBe('pass')
  })

  // 에러로 빠진 케이스가 조용히 분모를 줄이면 남은 한 건이 100% 를 만들어 게이트를 통과시킨다.
  it('is undecidable when test cases dropped out of the denominator on errors', () => {
    const dropped = { ...score, test: { ...score.test, undecided: ['p-002', 'p-003'] } }
    const v = verdict(dropped)
    expect(v.status).toBe('undecidable')
    expect(v.reasons.join(' ')).toMatch(/p-002/)
  })

  it('reports a definite failure as a failure even when cases also dropped out', () => {
    const dropped = {
      ...score,
      test: { ...score.test, positive: { hit: 1, total: 13 }, undecided: ['p-002'] }
    }
    const v = verdict(dropped)
    expect(v.status).toBe('fail')
    expect(v.reasons.join(' ')).toMatch(/발동률/)
    expect(v.reasons.join(' ')).toMatch(/p-002/)
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

describe('formatReport with judgeCheck', () => {
  it('warns when a pairwise result is present and the judge failed its self-check', () => {
    const out = formatReport({ meta, score, failures: [], pairwise, judgeCheck: 'untrusted' as const })
    expect(out).toContain('심판 신뢰성')
  })

  it('does not warn when the judge passed its self-check', () => {
    const out = formatReport({ meta, score, failures: [], pairwise, judgeCheck: 'trusted' as const })
    expect(out).not.toContain('심판 신뢰성')
  })

  // 검사를 안 돌린 것과 통과한 것이 화면에서 같아 보이면 안 된다.
  it('says the self-check never ran rather than staying silent', () => {
    const out = formatReport({ meta, score, failures: [], pairwise, judgeCheck: 'unchecked' as const })
    expect(out).toContain('자가진단 미수행')
    expect(out).not.toContain('심판 신뢰성 실패')
  })

  it('says nothing about the judge when there is no pairwise data', () => {
    const out = formatReport({ meta, score, failures: [], judgeCheck: 'unchecked' as const })
    expect(out).not.toContain('자가진단')
  })
})

describe('formatReport · 판정 3상태와 비용', () => {
  const emptyTest: TriggerScore = {
    train: { positive: { hit: 2, total: 3 }, negative: { falseHit: 0, total: 1 }, unstable: [], undecided: [], nError: 0 },
    test: { positive: { hit: 0, total: 0 }, negative: { falseHit: 0, total: 0 }, unstable: [], undecided: [], nError: 0 }
  }

  it('prints 판정 불가 instead of a tick when nothing was measured', () => {
    const out = formatReport({ meta, score: emptyTest, failures: [] })
    expect(out).toContain('판정  ? 판정 불가')
    expect(out).not.toContain('✓ 합격')
  })

  it('reports what a run cost so the delta can be weighed against it', () => {
    const out = formatReport({
      meta, score, failures: [],
      execution: { ok: 17, total: 17, timeouts: 0, errors: 0, durationMs: 413000, costUsd: 3.2409 },
      judgeCostUsd: 0.51
    })
    expect(out).toContain('record $3.24')
    expect(out).toContain('judge $0.51')
    expect(out).toContain('합계 $3.75')
  })

  // codex 는 이벤트에 비용 필드가 없어 0 이 나온다 — $0.00 이라고 단언하면 거짓말이 된다.
  it('omits the cost line entirely when no cost was captured', () => {
    const out = formatReport({
      meta, score, failures: [],
      execution: { ok: 2, total: 2, timeouts: 0, errors: 0, durationMs: 10, costUsd: 0 }
    })
    expect(out).not.toContain('비용')
  })

  it('warns when the case file no longer matches the recorded fingerprint', () => {
    const out = formatReport({ meta, score, failures: [], casesDrifted: true })
    expect(out).toContain('케이스 파일이 기록 시점과 다릅니다')
  })

  // 결정된 쌍이 하나도 없이 전부 폐기되면, 정성 축을 아예 안 잰 실행과 화면상 같아 보였다.
  it('still shows the discarded count when every pair was thrown away', () => {
    const allDiscarded: PairwiseScore = { win: 0, loss: 0, tie: 0, discarded: 4, rate: null }
    const out = formatReport({ meta, score, failures: [], pairwise: allDiscarded })
    expect(out).toContain('폐기된 판정 4건')
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

  it('shows only the forced total when no baseline ran — codex has no without variant', () => {
    const out = formatReport({ meta, score, failures: [], tokens: { forced: 4200, without: null } })
    expect(out).toMatch(/토큰[^\n]*4\.2k/)
    expect(out).not.toMatch(/토큰[^\n]*without/)
    expect(out).not.toMatch(/토큰[^\n]*—/)
  })
})

describe('formatDuration', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatDuration(45000)).toBe('45초')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(372000)).toBe('6분 12초')
  })
})

describe('formatReport execution summary', () => {
  it('shows the all-variant execution line with duration, omitting zero counts', () => {
    const out = formatReport({
      meta, score, failures: [],
      execution: { ok: 41, total: 42, timeouts: 1, errors: 0, durationMs: 372000, costUsd: 0 }
    })
    expect(out).toContain('41/42 ok')
    expect(out).toContain('1 timeout')
    expect(out).toContain('6분 12초')
    expect(out).not.toContain('0 error')
  })

  it('omits the execution line when not passed — old callers unaffected', () => {
    const out = formatReport({ meta, score, failures: [] })
    expect(out).not.toContain(' ok ·')
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

// Codex 파서는 이벤트에 스킬 목록이 없어 loadedSkills 를 항상 [] 로 낸다. 그때 '변화 없음' 을
// 단언하면 이 하네스가 제공하는 유일한 교란변수 통제 문장이 근거 없이 출력된다.
describe('formatDiff · 경쟁 스킬 목록이 비었을 때', () => {
  const run = (runId: string, loadedSkills: string[], runtime: RunMeta['runtime'] = 'claude') => ({
    meta: { ...meta, runId, loadedSkills, runtime },
    score
  })

  it('does not claim an unchanged field when neither run reported one', () => {
    const out = formatDiff(run('a', []), run('b', []))
    expect(out).toContain('확인할 수 없습니다')
    expect(out).not.toContain('스킬 자체의 변경에서 왔습니다')
  })

  it('still claims no change when both runs did report the same list', () => {
    const out = formatDiff(run('a', ['x:y']), run('b', ['x:y']))
    expect(out).toContain('스킬 자체의 변경에서 왔습니다')
  })

  it('still reports an actual change', () => {
    const out = formatDiff(run('a', ['x:y']), run('b', ['x:y', 'z:w']))
    expect(out).toContain('추가된 경쟁 스킬 1개')
  })
})
