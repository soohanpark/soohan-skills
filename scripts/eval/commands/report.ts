import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases } from '../cases.js'
import { casesFile, runDir } from '../paths.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { formatReport } from '../report.js'
import { collectFailures, scoreRules, scoreTrigger } from '../score.js'

/* v8 ignore start */
export const loadRun = (repoRoot: string, runId: string) => {
  const dir = runDir(repoRoot, runId)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as RunMeta
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]
  const cases = loadCases(casesFile(repoRoot, meta.skillId))
  return { meta, index, cases, score: scoreTrigger(index, cases) }
}

export const cmdReport = (runId: string, repoRoot: string): void => {
  const { meta, index, cases, score } = loadRun(repoRoot, runId)
  const rules = scoreRules(index, cases)
  console.log(formatReport({
    meta, score,
    failures: [...collectFailures(index, cases), ...rules.failures],
    rules: rules.test,
    hasBaselineRuns: index.some(e => e.variant === 'without')
  }))
}
/* v8 ignore stop */
