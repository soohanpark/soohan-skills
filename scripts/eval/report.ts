import type { RunMeta } from './record.js'
import type { Failure, TriggerScore } from './score.js'

const POSITIVE_FLOOR = 0.9
const NEGATIVE_CEILING = 0.1

export const pct = (n: number, d: number): string =>
  d === 0 ? '—' : `${Math.round((n / d) * 100)}%`

export const verdict = (score: TriggerScore): { passed: boolean; reasons: string[] } => {
  const reasons: string[] = []
  const t = score.test

  if (t.positive.total > 0 && t.positive.hit / t.positive.total < POSITIVE_FLOOR) {
    reasons.push(`positive 발동률 ${pct(t.positive.hit, t.positive.total)} < 90%`)
  }
  if (t.negative.total > 0 && t.negative.falseHit / t.negative.total > NEGATIVE_CEILING) {
    reasons.push(`negative 오발동률 ${pct(t.negative.falseHit, t.negative.total)} > 10%`)
  }

  return { passed: reasons.length === 0, reasons }
}

export const formatReport = (args: {
  meta: RunMeta
  score: TriggerScore
  failures: Failure[]
}): string => {
  const { meta, score, failures } = args
  const v = verdict(score)
  const lines: string[] = []

  lines.push(`skill-eval · ${meta.skillId} · ${meta.runId} · ${meta.model} · 경쟁 스킬 ${meta.loadedSkills.length}개`)
  lines.push('')
  lines.push('트리거                    test        train')
  lines.push(`  positive 발동률    ${score.test.positive.hit}/${score.test.positive.total}  ${pct(score.test.positive.hit, score.test.positive.total)}     ${score.train.positive.hit}/${score.train.positive.total}  ${pct(score.train.positive.hit, score.train.positive.total)}`)
  lines.push(`  negative 오발동률   ${score.test.negative.falseHit}/${score.test.negative.total}  ${pct(score.test.negative.falseHit, score.test.negative.total)}     ${score.train.negative.falseHit}/${score.train.negative.total}  ${pct(score.train.negative.falseHit, score.train.negative.total)}`)
  lines.push(`  unstable (2:1)           ${score.test.unstable.length}건        ${score.train.unstable.length}건`)
  lines.push(`  실행 에러                ${score.test.nError}건        ${score.train.nError}건`)

  if (meta.degradedBaseline) {
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
