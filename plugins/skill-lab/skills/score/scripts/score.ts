import type { EvalCase } from './cases.js'
import type { IndexEntry } from './record.js'
import { checkRules } from './rules.js'

export interface SplitScore {
  positive: { hit: number; total: number }
  negative: { falseHit: number; total: number }
  unstable: string[]
  // 전 회차가 에러라 분모에서 통째로 빠진 케이스들. 에러를 실패가 아니라 판정 불가로 빼는 것은
  // 옳지만, 그 사실이 판정에 안 보이면 남은 한 케이스가 100% 를 만들어 게이트를 통과시킨다.
  undecided: string[]
  // 아예 실행 기록이 없는 케이스들. record 가 중간에 끊기면 index 에 앞부분만 담기는데,
  // 그 부분 index 를 완주한 런과 똑같이 채점하면 "돌린 것만 세서 100%" 가 나온다.
  notRun: string[]
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
  undecided: [],
  notRun: [],
  nError: 0
})

const triggerRunsFor = (index: IndexEntry[], caseId: string) =>
  index.filter(e => e.variant === 'with' && e.caseId === caseId)

// Task 5 리뷰 이월: scoreTrigger와 collectFailures가 "ok 필터 → 2:1 다수결" 계산을
// 각자 베껴 썼다 — 텍스트가 같아서 우연히 일치했을 뿐이라 규칙이 바뀌면 조용히 어긋날 수 있었다.
// 이 필드가 생기기 전 index.json 이 runs/ 에 남아 있을 수 있다 — 없으면 빈 목록으로 읽는다.
const denialsOf = (run: IndexEntry): string[] => run.parsed.permissionDenials ?? []

// 권한 거부로 Skill 호출 자체가 막힌 실행은 "발동 안 함" 이 아니라 판정 불가다. 미발동으로
// 세면 리포트가 description 을 고치라고 안내하고, 멀쩡한 description 을 고치게 된다.
const okRuns = (runs: IndexEntry[]): IndexEntry[] =>
  runs.filter(r => r.parsed.status === 'ok' && !denialsOf(r).includes('Skill'))
const firedCount = (ok: IndexEntry[]): number => ok.filter(r => r.parsed.triggered).length
const firedMajority = (fired: number, ok: IndexEntry[]): boolean => fired * 2 > ok.length

export const scoreTrigger = (index: IndexEntry[], cases: EvalCase[]): TriggerScore => {
  const score: TriggerScore = { train: emptySplit(), test: emptySplit() }

  for (const c of cases) {
    const runs = triggerRunsFor(index, c.id)
    const bucket = score[c.split]
    // 계획에는 있는데 실행 기록이 없다 = record 가 여기까지 못 왔다. 조용히 넘기면 중단된
    // 실행의 부분 index 가 완주한 런과 구분 없이 채점된다.
    if (runs.length === 0) {
      bucket.notRun.push(c.id)
      continue
    }

    const ok = okRuns(runs)
    bucket.nError += runs.length - ok.length
    if (ok.length === 0) {
      // 전부 에러 — 판정 불가, 분모에서 제외 (설계 §10). 다만 빠졌다는 사실을 남긴다:
      // 조용히 빠지면 남은 케이스만으로 100% 가 나와 게이트를 통과한다.
      bucket.undecided.push(c.id)
      continue
    }

    const fired = firedCount(ok)
    if (fired > 0 && fired < ok.length) bucket.unstable.push(c.id)

    const majority = firedMajority(fired, ok)
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

    const ok = okRuns(runs)
    const errored = runs.filter(r => r.parsed.status !== 'ok')

    if (errored.length > 0) {
      const detail = ok.length === 0
        ? errored[0].parsed.terminalReason
        : `${errored[0].parsed.terminalReason} (${errored.length}/${runs.length})`
      failures.push({ caseId: c.id, kind: errored[0].parsed.status === 'timeout' ? 'timeout' : 'error', detail })
    }
    if (ok.length === 0) continue // 전부 에러 — 판정 불가, scoreTrigger와 동일 기준 (설계 §10)

    const fired = firedCount(ok)
    const majority = firedMajority(fired, ok)
    if (c.expect === 'trigger' && !majority) {
      failures.push({ caseId: c.id, kind: '미발동', detail: c.prompt })
    }
    if (c.expect === 'no-trigger' && majority) {
      failures.push({ caseId: c.id, kind: '오발동', detail: c.prompt })
    }
  }

  return failures
}

// forced 변형은 반복하지 않으므로 다수결이 필요 없다 — case당 forced 실행이 정상 종료했는지만 본다
// (실행 에러는 트리거 축과 같은 원칙으로 품질 실패가 아니라 판정 불가로 분모에서 제외한다).
// scoreTrigger와 마찬가지로 판정(pass/total)은 split별로 나눈다 — train에 맞춰 튜닝한 케이스가
// 전체 합격/불합격을 뒤집지 못하게 막기 위함이다 (설계 §과적합 방지). failures 목록만은 두 split을
// 합쳐서 보여준다 — 실패 사례를 숨기지 않되, 판정 자체는 test에서만 계산한다.
// undecided 는 트리거 축의 SplitScore.undecided 와 같은 역할이다 — 분모에서 빠진 케이스를
// 판정이 알아야 한다. 이게 없어서 forced 가 전부 제외돼도 must/must_not 게이트가 그냥
// 건너뛰어지고 '✓ 합격' 이 찍혔다 (적대적 리뷰 confirmed).
export interface RuleTally { pass: number; total: number; undecided: string[] }
export interface RuleScore { train: RuleTally; test: RuleTally; failures: Failure[] }

// forced 실행을 품질 판정의 근거로 쓸 수 있는가. 셋 다 참이어야 한다:
//  - 정상 종료했는가 (에러는 품질 실패가 아니라 판정 불가다)
//  - 잘리지 않았는가 (잘린 답변을 온전한 답변과 비교하면 품질이 아니라 절단을 재게 된다)
//  - 스킬이 실제로 붙었는가 — forced 는 슬래시 커맨드로 강제 발동시키는 변형인데, 스킬 id 가
//    틀리면 존재하지 않는 커맨드가 프롬프트에 얹힌 채 모델이 그냥 답해 버린다. 그 답에
//    must/must_not 을 매기면 "스킬 없이 낸 답"을 스킬 점수로 세게 된다. 아무도 이걸 확인하지
//    않아서 parsed.triggered 는 트리거 축에서만 소비되고 있었다.
export const forcedUsable = (
  run: IndexEntry,
  opts: { bodyInjected?: boolean } = {}
): { usable: true } | { usable: false; kind: Failure['kind']; detail: string } => {
  if (run.parsed.status !== 'ok') {
    return {
      usable: false,
      kind: run.parsed.status === 'timeout' ? 'timeout' : 'error',
      detail: `forced: ${run.parsed.terminalReason}`
    }
  }
  // 권한 거부는 실행을 멈추지 않는다 — 도구를 못 쓴 채 "권한을 주세요" 라고 답하고 정상
  // 종료한다. 그 답에 규칙을 매기면 측정 조건의 문제가 스킬의 품질 실패로 계상된다.
  // triggered 검사보다 먼저 본다: Skill 호출이 거부됐을 때 "스킬 id 를 확인하세요" 는 오진이다.
  const denials = denialsOf(run)
  if (denials.length > 0) {
    return {
      usable: false, kind: 'error',
      detail: `forced: 권한 거부로 도구를 못 썼습니다 (${[...new Set(denials)].join(', ')})`
    }
  }
  if (run.parsed.truncated) {
    return { usable: false, kind: 'error', detail: 'forced: 턴 한도에 걸려 답변이 잘렸습니다 — 품질 판정에서 제외' }
  }
  // 본문 주입 런은 "스킬이 붙었는가"가 구성상 보장된다 — Skill tool_use 블록 유무는 모델
  // 재량이라(같은 강제 명령이 블록 없이 체크리스트만 따른 실측 2026-07-30) 검사하면 오진이 된다.
  if (!opts.bodyInjected && !run.parsed.triggered) {
    return { usable: false, kind: 'error', detail: 'forced: 스킬이 발동하지 않았습니다 — 스킬 id 가 맞는지 확인하세요' }
  }
  return { usable: true }
}

export const scoreRules = (
  index: IndexEntry[],
  cases: EvalCase[],
  opts: { forcedBodyInjected?: boolean } = {}
): RuleScore => {
  const train: RuleTally = { pass: 0, total: 0, undecided: [] }
  const test: RuleTally = { pass: 0, total: 0, undecided: [] }
  const failures: Failure[] = []

  for (const c of cases) {
    if (!c.must && !c.must_not) continue
    const bucket = c.split === 'test' ? test : train
    const run = index.find(e => e.variant === 'forced' && e.caseId === c.id)
    if (!run) {
      bucket.undecided.push(c.id)
      continue
    }
    const usable = forcedUsable(run, { bodyInjected: opts.forcedBodyInjected })
    if (!usable.usable) {
      // 판정 불가 — 분모에서 빼되 실패 목록에는 남긴다. 조용히 빠지면 분모 축소가 안 보인다 (리뷰 R6)
      failures.push({ caseId: c.id, kind: usable.kind, detail: usable.detail })
      bucket.undecided.push(c.id)
      continue
    }

    bucket.total += 1
    const r = checkRules(run.parsed.finalText, c)
    if (r.passed) bucket.pass += 1
    else failures.push({ caseId: c.id, kind: 'must', detail: r.failures.join(', ') })
  }

  return { train, test, failures }
}

// forced 가 without 대비 토큰을 얼마나 더/덜 쓰는지 — 품질 델타의 일부로 기록한다 (설계 §7-4).
// 두 변형 모두 ok 인 케이스만 짝지어 합산한다 — 분모가 어긋나면 케이스 수 차이만으로 델타가
// 부풀려진다 (리뷰 R5). 짝이 하나도 없으면(without 이 없는 codex 등) forced 합계만 보고한다.
export const tokenDelta = (
  index: IndexEntry[],
  opts: { forcedBodyInjected?: boolean } = {}
): { forced: number; without: number | null } | null => {
  // forced 는 품질 판정과 같은 기준으로 거른다 — 스킬이 붙지 않은 실행의 토큰을 "스킬 사용량"
  // 으로 세면 델타가 스킬이 아니라 모델을 재게 된다. without 은 스킬이 없는 것이 정상이므로
  // 정상 종료·비절단만 본다 (절단된 쪽의 토큰은 "한도까지 쓴 양"이라 비교할 수 없다).
  const okRunsOf = (variant: 'forced' | 'without') =>
    index.filter(e => e.variant === variant && (
      variant === 'forced'
        ? forcedUsable(e, { bodyInjected: opts.forcedBodyInjected }).usable
        : e.parsed.status === 'ok' && !e.parsed.truncated
    ))

  const forcedRuns = okRunsOf('forced')
  if (forcedRuns.length === 0) return null

  const sum = (runs: IndexEntry[]) => runs.reduce((total, e) => total + e.parsed.tokens, 0)
  const withoutByCase = new Map(okRunsOf('without').map(e => [e.caseId, e]))
  const paired = forcedRuns.filter(e => withoutByCase.has(e.caseId))
  if (paired.length === 0) return { forced: sum(forcedRuns), without: null }

  return {
    forced: sum(paired),
    without: sum(paired.map(e => withoutByCase.get(e.caseId)!))
  }
}

export interface ReconSummary {
  triggered: number
  immediate: number
  afterRecon: number
}

// 발동 런을 "즉시"와 "정찰 후"로 가른다 — 트리거 축이 정찰 1턴을 허용하므로(--max-turns 2)
// 이 구분이 없으면 정찰 부류의 회복이 보이지 않는다 (1턴 측정에서는 통째로 미발동이었다,
// 실측 2026-07-30 47/54). reconToolCalls 가 없는 구 기록은 어느 쪽인지 알 수 없어 두 버킷
// 어디에도 넣지 않는다 — triggered 와 버킷 합이 다르면 구 기록이 섞였다는 뜻이다.
export const summarizeRecon = (index: IndexEntry[]): ReconSummary => {
  const fired = index.filter(e => e.variant === 'with' && e.parsed.triggered)
  const recon = (e: IndexEntry): unknown => e.parsed.reconToolCalls
  return {
    triggered: fired.length,
    immediate: fired.filter(e => recon(e) === 0).length,
    afterRecon: fired.filter(e => typeof recon(e) === 'number' && (recon(e) as number) > 0).length
  }
}

export interface ExecutionSummary {
  ok: number
  total: number
  timeouts: number
  errors: number
  durationMs: number
  // 파싱·저장은 되는데 집계·출력 지점이 없어서, 리포트가 이 측정에 얼마를 썼는지 말하지 않았다.
  costUsd: number
}

// 전 변형을 합친 실행 요약 (설계 §5-2). 트리거 축 밖(forced/without)의 실행 실패가
// 리포트에서 아예 안 보이는 것을 막는다 (리뷰 R6). durationMs 는 이번 호출에서 실제로
// 실행된 항목의 합 — recordAll 은 순차 실행이라 벽시계 시간과 근사하고, 재개로 재구성된
// 항목은 0 으로 들어온다.
export const summarizeExecution = (index: IndexEntry[]): ExecutionSummary => ({
  ok: index.filter(e => e.parsed.status === 'ok').length,
  total: index.length,
  timeouts: index.filter(e => e.parsed.status === 'timeout').length,
  errors: index.filter(e => e.parsed.status === 'error').length,
  durationMs: index.reduce((t, e) => t + e.durationMs, 0),
  costUsd: index.reduce((t, e) => t + e.parsed.costUsd, 0)
})
