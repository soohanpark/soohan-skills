import { CASES_HASH_PREFIX } from './cases.js'
import type { JudgeCheck, PairwiseScore } from './judge.js'
import type { RunMeta } from './record.js'
import type { ExecutionSummary, Failure, ReconSummary, RuleTally, TriggerScore } from './score.js'

const POSITIVE_FLOOR = 0.9
const NEGATIVE_CEILING = 0.1
const PAIRWISE_FLOOR = 0.6

// 합격·불합격의 2상태로는 "측정했는데 통과" 와 "측정이 없었다" 가 화면에서 구분되지 않는다.
export type VerdictStatus = 'pass' | 'fail' | 'undecidable'

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

export const formatDuration = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
}

// 게이트는 전부 "분모가 0이면 건너뛴다"로 방어돼 있다. 그 자체는 옳지만, 전부 건너뛰면
// 아무 사유도 안 쌓인 채 합격이 나온다 — split 을 안 적었을 때 실제로 그렇게 됐다. 그래서
// 통과한 게이트가 몇 개였는지를 세고, 측정이 성립하지 않은 사유는 reasons 와 따로 모은다.
export interface VerdictInput {
  score: TriggerScore
  rules?: RuleTally
  pairwise?: PairwiseScore
  judgeCheck?: JudgeCheck
  // 정성 축을 선언해 놓고(qualitative: true) judge 를 아직 안 돌린 test 케이스 수.
  // 0보다 큰데 pairwise 가 없으면 정성 축을 잰 것이 아니라 안 잰 것이다.
  qualitativeAwaitingJudge?: number
}

export const verdict = (input: VerdictInput): { status: VerdictStatus; reasons: string[] } => {
  const { score, rules, pairwise, judgeCheck = 'unchecked', qualitativeAwaitingJudge = 0 } = input
  const reasons: string[] = []
  const blockers: string[] = []
  const t = score.test
  let gatesEvaluated = 0

  if (t.positive.total > 0) {
    gatesEvaluated += 1
    if (t.positive.hit / t.positive.total < POSITIVE_FLOOR) {
      reasons.push(`positive 발동률 ${pct(t.positive.hit, t.positive.total)} < 90%`)
    }
  }
  if (t.negative.total > 0) {
    gatesEvaluated += 1
    if (t.negative.falseHit / t.negative.total > NEGATIVE_CEILING) {
      reasons.push(`negative 오발동률 ${pct(t.negative.falseHit, t.negative.total)} > 10%`)
    }
  }
  if (rules && rules.total > 0) {
    gatesEvaluated += 1
    if (rules.pass / rules.total < POSITIVE_FLOOR) {
      reasons.push(`must/must_not ${pct(rules.pass, rules.total)} < 90%`)
    }
  }

  // 심판이 자가진단(A=A)을 통과하지 못했거나 아예 수행되지 않았다면 정성 축은 판정 불능이다.
  const pairwiseDecided = pairwise !== undefined && pairwise.rate !== null
  if (pairwiseDecided && judgeCheck === 'trusted') {
    gatesEvaluated += 1
    if (pairwise!.rate! < PAIRWISE_FLOOR) {
      reasons.push(
        `페어와이즈 승률 ${Math.round(pairwise!.rate! * 100)}% < 60% — 스킬의 존재 의미를 재검토하세요`
      )
    }
  }

  if (gatesEvaluated === 0) {
    blockers.push('test split 에서 평가된 게이트가 하나도 없습니다 — 케이스에 split 이 지정됐는지 확인하세요')
  }
  // 발동 여부가 이 하네스의 1차 축이다. negative 만으로 게이트가 채워지면 "오발동은 안 한다"만
  // 확인하고 "발동은 하는가"는 한 번도 재지 않은 채 합격이 나온다.
  if (t.positive.total === 0 && gatesEvaluated > 0) {
    blockers.push('test split 에 측정된 positive 케이스가 없습니다 — 발동 여부를 재지 않았습니다')
  }
  if (t.notRun.length > 0) {
    blockers.push(`test 케이스 ${t.notRun.length}건에 실행 기록이 없습니다 — 중단된 실행일 수 있습니다 (${t.notRun.join(', ')})`)
  }
  if (t.undecided.length > 0) {
    blockers.push(`test 케이스 ${t.undecided.length}건이 실행 에러로 측정되지 않았습니다 (${t.undecided.join(', ')})`)
  }
  if (rules && rules.undecided.length > 0) {
    blockers.push(`must/must_not test 케이스 ${rules.undecided.length}건이 측정되지 않았습니다 (${rules.undecided.join(', ')})`)
  }
  if (qualitativeAwaitingJudge > 0 && pairwise === undefined) {
    blockers.push(`정성 축을 선언한 test 케이스가 ${qualitativeAwaitingJudge}건 있는데 judge 를 돌리지 않았습니다`)
  }
  // 쌍이 전부 폐기되면 승률 분모가 0이라 게이트가 건너뛰어진다 — 잰 것이 아니라 못 잰 것이다.
  if (pairwise !== undefined && pairwise.rate === null && pairwise.discarded > 0) {
    blockers.push(`페어와이즈 쌍 ${pairwise.discarded}건이 전부 폐기되어 정성 축을 판정할 수 없습니다`)
  }
  if (pairwiseDecided && judgeCheck !== 'trusted') {
    blockers.push(judgeCheck === 'unchecked'
      ? '심판 자가진단이 수행되지 않아 정성 축을 판정할 수 없습니다'
      : '심판이 자가진단을 통과하지 못해 정성 축을 판정할 수 없습니다')
  }

  // 확정된 불합격 사유가 있으면 그쪽이 우선한다 — 판정 불가보다 행동 가능한 정보다.
  // 다만 측정이 성립하지 않은 사유도 함께 보여준다.
  if (reasons.length > 0) return { status: 'fail', reasons: [...reasons, ...blockers] }
  if (blockers.length > 0) return { status: 'undecidable', reasons: blockers }
  return { status: 'pass', reasons: [] }
}

export const formatReport = (args: {
  meta: RunMeta
  score: TriggerScore
  failures: Failure[]
  hasBaselineRuns?: boolean
  rules?: RuleTally
  pairwise?: PairwiseScore
  judgeCheck?: JudgeCheck
  qualitativeAwaitingJudge?: number
  judgeCostUsd?: number
  tokens?: { forced: number; without: number | null }
  execution?: ExecutionSummary
  casesDrifted?: boolean
  recon?: ReconSummary
}): string => {
  const { meta, score, failures, hasBaselineRuns, rules, pairwise, judgeCheck, judgeCostUsd, tokens, execution, recon } = args
  const v = verdict({
    score, rules, pairwise, judgeCheck,
    qualitativeAwaitingJudge: args.qualitativeAwaitingJudge
  })
  const lines: string[] = []

  lines.push(`skill-eval · ${meta.skillId} · ${meta.runId} · ${meta.model} · 경쟁 스킬 ${meta.loadedSkills.length}개`)
  if (execution && execution.total > 0) {
    const parts = [`${execution.ok}/${execution.total} ok`]
    if (execution.timeouts > 0) parts.push(`${execution.timeouts} timeout`)
    if (execution.errors > 0) parts.push(`${execution.errors} error`)
    if (execution.durationMs > 0) parts.push(formatDuration(execution.durationMs))
    lines.push(`실행  ${parts.join(' · ')}`)
  }
  // "그 개선이 비용 대비 합리적인가"를 물으려면 얼마를 썼는지가 화면에 있어야 한다.
  // codex 는 이벤트에 비용 필드가 없어 0 이 나오므로, 0 이면 줄 자체를 내지 않는다.
  const recordCost = execution?.costUsd ?? 0
  if (recordCost > 0 || (judgeCostUsd ?? 0) > 0) {
    const parts = [`record $${recordCost.toFixed(2)}`]
    if (judgeCostUsd !== undefined) parts.push(`judge $${judgeCostUsd.toFixed(2)}`)
    if (judgeCostUsd !== undefined) parts.push(`합계 $${(recordCost + judgeCostUsd).toFixed(2)}`)
    lines.push(`비용  ${parts.join(' · ')}`)
  }
  lines.push('')
  lines.push('트리거                    test        train')
  lines.push(`  positive 발동률    ${score.test.positive.hit}/${score.test.positive.total}  ${pct(score.test.positive.hit, score.test.positive.total)}     ${score.train.positive.hit}/${score.train.positive.total}  ${pct(score.train.positive.hit, score.train.positive.total)}`)
  lines.push(`  negative 오발동률   ${score.test.negative.falseHit}/${score.test.negative.total}  ${pct(score.test.negative.falseHit, score.test.negative.total)}     ${score.train.negative.falseHit}/${score.train.negative.total}  ${pct(score.train.negative.falseHit, score.train.negative.total)}`)
  lines.push(`  unstable (2:1)           ${score.test.unstable.length}건        ${score.train.unstable.length}건`)
  lines.push(`  실행 에러                ${score.test.nError}건        ${score.train.nError}건`)
  // 정찰 후 발동은 1턴 측정에서 통째로 미발동으로 집계되던 부류다 (실측 2026-07-30, 47/54).
  // 구 기록에는 지표가 없어 두 버킷 합이 발동 수보다 작을 수 있다.
  if (recon && recon.triggered > 0) {
    lines.push(`  발동 시점 (전 런)        즉시 ${recon.immediate}런 · 정찰 후 ${recon.afterRecon}런`)
  }

  const showRules = Boolean(rules && rules.total > 0)
  // 폐기된 판정도 "정성 축을 재려다 실패했다"는 신호다. 결정된 쌍이 하나도 없을 때 이 줄까지
  // 같이 사라지면, 정성 축을 아예 안 잰 실행과 재려다 전부 버린 실행이 화면에서 똑같아 보인다.
  const showPairwise = Boolean(pairwise && (pairwise.win + pairwise.loss + pairwise.tie + pairwise.discarded) > 0)
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
    }
    if (pairwise && pairwise.discarded > 0) {
      lines.push(`  (폐기된 판정 ${pairwise.discarded}건 — 기준 밖 근거이거나 비교 조건을 못 갖춘 쌍)`)
    }
    if (tokens && tokens.forced > 0) {
      // without: null 은 baseline 자체가 없는 실행(codex 등) — 델타 없이 forced 사용량만 보여준다
      lines.push(tokens.without === null
        ? `  토큰          forced ${formatTokenCount(tokens.forced)}`
        : `  토큰          forced ${formatTokenCount(tokens.forced)} / without ${formatTokenCount(tokens.without)}  (${tokenPctChange(tokens.forced, tokens.without)})`)
    }
  }

  // "검사했고 통과" 와 "검사를 안 했다" 는 다른 상태다. 후자가 전자로 표시되면 아무것도
  // 검증하지 않은 실행이 '신뢰함'으로 보인다.
  if (pairwise && judgeCheck === 'untrusted') {
    lines.push('')
    lines.push('⚠ 심판 신뢰성 실패 — 정성 판정 심판이 자가진단(A=A 검사)을 통과하지 못했습니다. 페어와이즈 결과를 신뢰하지 마세요.')
  }
  if (pairwise && judgeCheck === 'unchecked') {
    lines.push('')
    lines.push('⚠ 심판 자가진단 미수행 — 검사에 쓸 forced 실행이 없어 A=A 검사를 돌리지 못했습니다. 통과한 것이 아닙니다.')
  }

  if (args.casesDrifted) {
    lines.push('')
    lines.push('⚠ 케이스 파일이 기록 시점과 다릅니다 — 아래 점수는 지금의 cases.jsonl 로 옛 실행을 다시 채점한 결과입니다.')
  }

  if (meta.sideEffectsAllowed) {
    lines.push('')
    lines.push('⚠ 부수효과 도구 허용 — MCP 서버와 외부 작용 도구를 켠 채 측정했습니다. 이 실행은 외부 시스템에 도달했을 수 있습니다.')
  }

  // 격리 여부는 점수 해석의 전제다 — 비격리 트리거 축은 계정의 전역 스킬·훅·CLAUDE.md 와
  // 경쟁한 결과라, 미발동이 description 신호가 아닐 수 있다 (msuarcade:init 실측: 실패 10건 중
  // 9건이 전역 훅에 첫 턴을 뺏긴 것). 이 필드가 생기기 전 실행은 'off' 로 읽는다.
  const isolation = meta.isolation ?? 'off'
  if (isolation === 'full') {
    lines.push('')
    lines.push('격리 실행 — 빈 전용 cwd에서 유저 스코프를 제외하고 대상 플러그인만 로드했습니다. 트리거 축은 격리(진공) 발동률이고, baseline 은 플러그인 없이 돌았습니다.')
  } else if (isolation === 'cwd') {
    lines.push('')
    lines.push('격리 실행(부분) — 빈 전용 cwd를 썼지만 개인 스킬이라 유저 스코프 스킬·지시문과는 경쟁한 발동률입니다.')
  } else if ((meta.runtime ?? 'claude') === 'claude') {
    lines.push('')
    lines.push('⚠ 비격리 실행 — 계정의 전역 스킬·훅·CLAUDE.md 와 경쟁한 트리거 축입니다. 미발동을 description 탓으로 돌리기 전에 격리 기록으로 다시 재보세요.')
  }

  // 자체 훅이 발동을 밀어붙이는 플러그인(실측 2026-07-30, superpowers)의 트리거 숫자를
  // description 공로로 읽으면 엉뚱한 곳을 고치게 된다.
  if ((meta.pluginHasHooks ?? false) && isolation === 'full') {
    lines.push('')
    lines.push('대상 플러그인이 훅을 포함합니다 — 트리거 축은 description 단독이 아니라 플러그인 전체(훅 포함)의 발동률입니다.')
  }

  if (meta.forcedBodyInjected ?? false) {
    lines.push('')
    lines.push('forced 는 SKILL.md 본문을 프롬프트로 주입해 실행됐습니다 — 본문 확보가 구성상 보장되어 Skill 호출 여부를 검사하지 않습니다.')
  }

  if (meta.degradedBaseline && hasBaselineRuns) {
    lines.push('')
    lines.push('⚠ baseline 저하 — Read/Grep/Glob를 전면 차단해 실행했습니다. 파일을 읽는 스킬이면 품질 델타가 과대평가됩니다.')
  }

  lines.push('')
  if (v.status === 'pass') lines.push('판정  ✓ 합격')
  else if (v.status === 'fail') lines.push(`판정  ✗ 불합격 — ${v.reasons.join(', ')}`)
  else lines.push(`판정  ? 판정 불가 — ${v.reasons.join(', ')}`)

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

  // 두 런의 케이스 파일이 다르면 발동률 차이는 스킬이 아니라 문제지가 바뀐 결과다.
  // 재계산할 수 있는 포맷의 지문이 양쪽에 있고 값이 다를 때만 말할 수 있다.
  const bothHashed = (before.meta.casesHash ?? '').startsWith(CASES_HASH_PREFIX) &&
                     (after.meta.casesHash ?? '').startsWith(CASES_HASH_PREFIX)
  const casesChanged = bothHashed && before.meta.casesHash !== after.meta.casesHash
  if (casesChanged) {
    lines.push('  ⚠ 두 실행의 케이스 파일이 다릅니다 — 점수 변화를 스킬 변경 탓으로 돌릴 수 없습니다.')
    lines.push('')
  }

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

  // 목록이 양쪽 다 비었으면 "경쟁 스킬이 없었다"가 아니라 "보고되지 않았다"일 수 있다.
  // Codex 파서는 구조적으로 항상 빈 목록을 낸다 — 그때 '변화 없음' 을 단언하면, 이 하네스가
  // 제공하는 유일한 교란변수 통제 문장이 근거 없이 출력된다.
  if (before.meta.loadedSkills.length === 0 && after.meta.loadedSkills.length === 0) {
    lines.push('  경쟁 스킬 목록이 비어 있습니다 — 경쟁 환경이 같았는지 확인할 수 없습니다.')
  } else if (added.length === 0 && removed.length === 0) {
    // 케이스가 바뀌었으면 경쟁 환경이 같아도 인과를 스킬로 돌릴 수 없다.
    lines.push(casesChanged
      ? '  경쟁 스킬 변화 없음 — 다만 케이스 파일이 달라 점수 변화의 원인을 가릴 수 없습니다.'
      : '  경쟁 스킬 변화 없음 — 점수 변화는 스킬 자체의 변경에서 왔습니다.')
  } else {
    if (added.length > 0) lines.push(`  추가된 경쟁 스킬 ${added.length}개: ${added.join(', ')}`)
    if (removed.length > 0) lines.push(`  사라진 경쟁 스킬 ${removed.length}개: ${removed.join(', ')}`)
    lines.push('  ⚠ 경쟁 환경이 바뀌었습니다. 점수 변화를 스킬 변경 탓으로만 돌리지 마세요.')
  }

  return lines.join('\n')
}
