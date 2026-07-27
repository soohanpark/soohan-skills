import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases } from '../cases.js'
import type { PairwiseScore } from '../judge.js'
import { casesFile, evalsRoot, runDir } from '../paths.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { formatDiff, formatReport } from '../report.js'
import { collectFailures, scoreRules, scoreTrigger, summarizeExecution, tokenDelta } from '../score.js'

/* v8 ignore start */
export const loadRun = (repoRoot: string, runId: string) => {
  const dir = runDir(repoRoot, runId)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as RunMeta
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]
  const cases = loadCases(casesFile(repoRoot, meta.skillId))
  return { meta, index, cases, score: scoreTrigger(index, cases) }
}

// judge 서브커맨드가 만든 evals/verdicts/<runId>.json 이 있으면 읽는다.
// 아직 judge 를 돌리지 않은 실행은 파일이 없다 — 그 경우 undefined 를 돌려주고
// formatReport 가 품질 축의 페어와이즈 줄을 그냥 생략하게 둔다.
const loadPairwise = (repoRoot: string, runId: string): { score: PairwiseScore; judgeTrustworthy: boolean } | undefined => {
  const file = join(evalsRoot(repoRoot), 'verdicts', `${runId}.json`)
  if (!existsSync(file)) return undefined
  const data = JSON.parse(readFileSync(file, 'utf8')) as { score: PairwiseScore; judgeTrustworthy: boolean }
  return { score: data.score, judgeTrustworthy: data.judgeTrustworthy }
}

export const cmdReport = (runId: string, repoRoot: string): void => {
  const { meta, index, cases, score } = loadRun(repoRoot, runId)
  const rules = scoreRules(index, cases)
  const pairwise = loadPairwise(repoRoot, runId)
  console.log(formatReport({
    meta, score,
    failures: [...collectFailures(index, cases), ...rules.failures],
    rules: rules.test,
    pairwise: pairwise?.score,
    judgeTrustworthy: pairwise?.judgeTrustworthy,
    hasBaselineRuns: index.some(e => e.variant === 'without'),
    tokens: tokenDelta(index) ?? undefined,
    execution: summarizeExecution(index)
  }))
}

export const cmdDiff = (beforeId: string, afterId: string, repoRoot: string): void => {
  console.log(formatDiff(loadRun(repoRoot, beforeId), loadRun(repoRoot, afterId)))
}
/* v8 ignore stop */
