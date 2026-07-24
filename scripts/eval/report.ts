import type { PairwiseScore } from './judge.js'
import type { RunMeta } from './record.js'
import type { Failure, TriggerScore } from './score.js'

const POSITIVE_FLOOR = 0.9
const NEGATIVE_CEILING = 0.1
const PAIRWISE_FLOOR = 0.6

export const pct = (n: number, d: number): string =>
  d === 0 ? '—' : `${Math.round((n / d) * 100)}%`

// 큰 토큰 수를 사람이 읽기 좋게 줄인다 — 4200 → "4.2k", 999 → "999" 그대로.
export const formatTokenCount = (n: number): string =>
  n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`

// (forced-without)/without 의 상대 변화율. without 이 0이면 나눌 수 없으니 대시로 표시한다.
const tokenPctChange = (forced: number, without: number): string => {
  if (without === 0) return '—'
  const d = Math.round(((forced - without) / without) * 100)
  return `${d > 0 ? '+' : ''}${d}%`
}

export const verdict = (
  score: TriggerScore,
  rules?: { pass: number; total: number },
  pairwise?: PairwiseScore,
  judgeTrustworthy = true
): { passed: boolean; reasons: string[] } => {
  const reasons: string[] = []
  const t = score.test

  if (t.positive.total > 0 && t.positive.hit / t.positive.total < POSITIVE_FLOOR) {
    reasons.push(`positive 발동률 ${pct(t.positive.hit, t.positive.total)} < 90%`)
  }
  if (t.negative.total > 0 && t.negative.falseHit / t.negative.total > NEGATIVE_CEILING) {
    reasons.push(`negative 오발동률 ${pct(t.negative.falseHit, t.negative.total)} > 10%`)
  }
  if (rules && rules.total > 0 && rules.pass / rules.total < POSITIVE_FLOOR) {
    reasons.push(`must/must_not ${pct(rules.pass, rules.total)} < 90%`)
  }
  // 심판이 자가진단(A=A)을 통과하지 못했다면 정성 축은 판정 불능이다 — 합격도 불합격도 시키지 않는다.
  if (judgeTrustworthy !== false && pairwise && pairwise.rate !== null && pairwise.rate < PAIRWISE_FLOOR) {
    reasons.push(
      `페어와이즈 승률 ${Math.round(pairwise.rate * 100)}% < 60% — 스킬의 존재 의미를 재검토하세요`
    )
  }

  return { passed: reasons.length === 0, reasons }
}

export const formatReport = (args: {
  meta: RunMeta
  score: TriggerScore
  failures: Failure[]
  hasBaselineRuns?: boolean
  rules?: { pass: number; total: number }
  pairwise?: PairwiseScore
  judgeTrustworthy?: boolean
  tokens?: { forced: number; without: number }
}): string => {
  const { meta, score, failures, hasBaselineRuns, rules, pairwise, judgeTrustworthy, tokens } = args
  const v = verdict(score, rules, pairwise, judgeTrustworthy)
  const lines: string[] = []

  lines.push(`skill-eval · ${meta.skillId} · ${meta.runId} · ${meta.model} · 경쟁 스킬 ${meta.loadedSkills.length}개`)
  lines.push('')
  lines.push('트리거                    test        train')
  lines.push(`  positive 발동률    ${score.test.positive.hit}/${score.test.positive.total}  ${pct(score.test.positive.hit, score.test.positive.total)}     ${score.train.positive.hit}/${score.train.positive.total}  ${pct(score.train.positive.hit, score.train.positive.total)}`)
  lines.push(`  negative 오발동률   ${score.test.negative.falseHit}/${score.test.negative.total}  ${pct(score.test.negative.falseHit, score.test.negative.total)}     ${score.train.negative.falseHit}/${score.train.negative.total}  ${pct(score.train.negative.falseHit, score.train.negative.total)}`)
  lines.push(`  unstable (2:1)           ${score.test.unstable.length}건        ${score.train.unstable.length}건`)
  lines.push(`  실행 에러                ${score.test.nError}건        ${score.train.nError}건`)

  const showRules = Boolean(rules && rules.total > 0)
  const showPairwise = Boolean(pairwise && (pairwise.win + pairwise.loss + pairwise.tie) > 0)
  const showTokens = Boolean(tokens && tokens.forced > 0)
  if (showRules || showPairwise || showTokens) {
    lines.push('')
    lines.push('품질')
    if (rules && rules.total > 0) {
      lines.push(`  must/must_not      ${rules.pass}/${rules.total}  ${pct(rules.pass, rules.total)}`)
    }
    if (pairwise && (pairwise.win + pairwise.loss + pairwise.tie) > 0) {
      const rate = pairwise.rate === null ? '—' : `${Math.round(pairwise.rate * 100)}%`
      lines.push(`  페어와이즈 승률     ${pairwise.win}승 ${pairwise.tie}무 ${pairwise.loss}패  ${rate}`)
      if (pairwise.discarded > 0) lines.push(`  (기준 밖 근거로 폐기된 판정 ${pairwise.discarded}건)`)
    }
    if (tokens && tokens.forced > 0) {
      lines.push(`  토큰          forced ${formatTokenCount(tokens.forced)} / without ${formatTokenCount(tokens.without)}  (${tokenPctChange(tokens.forced, tokens.without)})`)
    }
  }

  if (pairwise && judgeTrustworthy === false) {
    lines.push('')
    lines.push('⚠ 심판 신뢰성 실패 — 정성 판정 심판이 자가진단(A=A 검사)을 통과하지 못했습니다. 페어와이즈 결과를 신뢰하지 마세요.')
  }

  if (meta.degradedBaseline && hasBaselineRuns) {
    lines.push('')
    lines.push('⚠ baseline 저하 — Read/Grep/Glob를 전면 차단해 실행했습니다. 파일을 읽는 스킬이면 품질 델타가 과대평가됩니다.')
  }

  lines.push('')
  lines.push(v.passed ? '판정  ✓ 합격' : `판정  ✗ 불합격 — ${v.reasons.join(', ')}`)

  if (failures.length > 0) {
    lines.push('')
    lines.push('실패 케이스')
    for (const f of failures) {
      lines.push(`  ${f.caseId.padEnd(8)} ${f.kind.padEnd(6)} ${f.detail}`)
    }
  }

  return lines.join('\n')
}

const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d)

const signedPct = (before: number | null, after: number | null): string => {
  if (before === null || after === null) return '—'
  const delta = Math.round((after - before) * 100)
  return `${delta > 0 ? '+' : ''}${delta}%`
}

export const formatDiff = (
  before: { meta: RunMeta; score: TriggerScore },
  after: { meta: RunMeta; score: TriggerScore }
): string => {
  const lines: string[] = []
  lines.push(`회귀 비교 · ${before.meta.runId} → ${after.meta.runId}`)
  lines.push('')

  const bp = before.score.test.positive
  const ap = after.score.test.positive
  const bn = before.score.test.negative
  const an = after.score.test.negative

  lines.push(`  positive 발동률   ${pct(bp.hit, bp.total)} → ${pct(ap.hit, ap.total)}   ${signedPct(rate(bp.hit, bp.total), rate(ap.hit, ap.total))}`)
  lines.push(`  negative 오발동률  ${pct(bn.falseHit, bn.total)} → ${pct(an.falseHit, an.total)}   ${signedPct(rate(bn.falseHit, bn.total), rate(an.falseHit, an.total))}`)
  lines.push('')

  // meta.runtime 은 이 필드가 생기기 전 실행에는 없다 — runs/ 는 gitignore 대상이라 마이그레이션
  // 없이 읽는 쪽 기본값(claude)으로 방어한다.
  const beforeRuntime = before.meta.runtime ?? 'claude'
  const afterRuntime = after.meta.runtime ?? 'claude'

  if (beforeRuntime !== afterRuntime) {
    lines.push(`  ⚠ 서로 다른 런타임 비교입니다 (${beforeRuntime} → ${afterRuntime}) — 측정 조건 자체가 달라 이 비교는 신뢰할 수 없습니다.`)
    lines.push('  Codex는 경쟁 스킬 목록을 보고하지 않으므로 경쟁 스킬 diff는 생략합니다.')
    return lines.join('\n')
  }

  // 점수 변화의 원인이 내 스킬인지 남의 스킬인지 가르는 유일한 근거 (설계 §4-2)
  const beforeSet = new Set(before.meta.loadedSkills)
  const afterSet = new Set(after.meta.loadedSkills)
  const added = after.meta.loadedSkills.filter(s => !beforeSet.has(s))
  const removed = before.meta.loadedSkills.filter(s => !afterSet.has(s))

  if (added.length === 0 && removed.length === 0) {
    lines.push('  경쟁 스킬 변화 없음 — 점수 변화는 스킬 자체의 변경에서 왔습니다.')
  } else {
    if (added.length > 0) lines.push(`  추가된 경쟁 스킬 ${added.length}개: ${added.join(', ')}`)
    if (removed.length > 0) lines.push(`  사라진 경쟁 스킬 ${removed.length}개: ${removed.join(', ')}`)
    lines.push('  ⚠ 경쟁 환경이 바뀌었습니다. 점수 변화를 스킬 변경 탓으로만 돌리지 마세요.')
  }

  return lines.join('\n')
}
