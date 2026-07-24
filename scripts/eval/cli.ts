import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cmdJudge } from './commands/judge.js'
import { cmdMine } from './commands/mine.js'
import { cmdRecord } from './commands/record.js'
import { cmdDiff, cmdReport } from './commands/report.js'
import { evalsRoot } from './paths.js'

/* v8 ignore start */
const usage = (repoRoot: string) => {
  console.log('사용법: pnpm eval <record|report> <인자>')
  console.log('  record <plugin:skill | SKILL.md 경로>')
  console.log('  report <runId>')
  console.log('  report --diff <beforeRunId> <afterRunId>')
  const runsDir = join(evalsRoot(repoRoot), 'runs')
  if (existsSync(runsDir)) {
    const runs = readdirSync(runsDir).slice(-5)
    if (runs.length) console.log(`  최근 runId: ${runs.join(', ')}`)
  }
}

const isMain = () => {
  if (typeof process === 'undefined' || !process.argv[1]) return false
  return fileURLToPath(import.meta.url) === process.argv[1]
}

if (isMain()) {
  const repoRoot = process.cwd()
  const [sub, arg] = process.argv.slice(2)
  if (sub === 'record' && arg) await cmdRecord(arg, repoRoot)
  else if (sub === 'report' && arg === '--diff') cmdDiff(process.argv[4], process.argv[5], repoRoot)
  else if (sub === 'report' && arg) cmdReport(arg, repoRoot)
  else if (sub === 'judge' && arg) await cmdJudge(arg, repoRoot)
  else if (sub === 'mine' && arg) await cmdMine(arg, repoRoot)
  else { usage(repoRoot); process.exit(1) }
}
/* v8 ignore stop */
