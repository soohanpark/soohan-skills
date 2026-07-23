import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases } from '../cases.js'
import { casesFile, runDir } from '../paths.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { formatReport } from '../report.js'
import { collectFailures, scoreTrigger } from '../score.js'

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
  console.log(formatReport({ meta, score, failures: collectFailures(index, cases) }))
}
/* v8 ignore stop */
