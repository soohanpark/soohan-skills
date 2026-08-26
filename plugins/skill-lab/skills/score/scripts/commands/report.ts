import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { casesDrifted, hashCases, loadCases } from '../cases.js'
import { readJudgeCheck, type JudgeCheck, type PairwiseScore } from '../judge.js'
import { casesFile, evalsRoot, runDir } from '../paths.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { formatDiff, formatReport } from '../report.js'
import { collectFailures, scoreRules, scoreTrigger, summarizeExecution, summarizeRecon, tokenDelta } from '../score.js'

/* v8 ignore start */
export const loadRun = (repoRoot: string, runId: string) => {
  const dir = runDir(repoRoot, runId)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as RunMeta
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]
  const cases = loadCases(casesFile(repoRoot, meta.skillId))
  // 기록 시점의 케이스와 지금 파일이 같은지. report 는 호출 시점의 cases.jsonl 로 채점하므로,
  // 기록 뒤에 케이스를 고치면 (특히 split 을 지우면) 같은 원본이 다른 판정을 낸다.
  const drifted = casesDrifted(meta.casesHash, hashCases(cases))
  return { meta, index, cases, drifted, score: scoreTrigger(index, cases) }
}

// judge 서브커맨드가 만든 evals/verdicts/<runId>.json 이 있으면 읽는다.
// 아직 judge 를 돌리지 않은 실행은 파일이 없다 — 그 경우 undefined 를 돌려주고
// formatReport 가 품질 축의 페어와이즈 줄을 그냥 생략하게 둔다.
const loadPairwise = (repoRoot: string, runId: string): { score: PairwiseScore; judgeCheck: JudgeCheck; costUsd?: number } | undefined => {
  const file = join(evalsRoot(repoRoot), 'verdicts', `${runId}.json`)
  if (!existsSync(file)) return undefined
  const data = JSON.parse(readFileSync(file, 'utf8')) as
    { score: PairwiseScore; costUsd?: number; judgeCheck?: unknown; judgeTrustworthy?: unknown }
  return { score: data.score, judgeCheck: readJudgeCheck(data), costUsd: data.costUsd }
}

export const cmdReport = (runId: string, repoRoot: string): void => {
  const { meta, index, cases, drifted, score } = loadRun(repoRoot, runId)
  // 본문 주입 런의 forced 는 발동 검사를 걸지 않는다 — 측정 조건은 meta 가 안다.
  const forcedBodyInjected = meta.forcedBodyInjected ?? false
  const rules = scoreRules(index, cases, { forcedBodyInjected })
  const pairwise = loadPairwise(repoRoot, runId)
  console.log(formatReport({
    meta, score,
    failures: [...collectFailures(index, cases), ...rules.failures],
    rules: rules.test,
    pairwise: pairwise?.score,
    judgeCheck: pairwise?.judgeCheck,
    judgeCostUsd: pairwise?.costUsd,
    // 정성 축을 선언해 놓고 judge 를 안 돌렸으면, 리포트에 정성 줄이 없는 것은
    // "잴 것이 없었다"가 아니라 "재지 않았다"다.
    qualitativeAwaitingJudge: cases.filter(c => c.qualitative && c.split === 'test').length,
    hasBaselineRuns: index.some(e => e.variant === 'without'),
    tokens: tokenDelta(index, { forcedBodyInjected }) ?? undefined,
    execution: summarizeExecution(index),
    casesDrifted: drifted,
    recon: summarizeRecon(index)
  }))
}

export const cmdDiff = (beforeId: string, afterId: string, repoRoot: string): void => {
  console.log(formatDiff(loadRun(repoRoot, beforeId), loadRun(repoRoot, afterId)))
}
/* v8 ignore stop */
