import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cmdJudge } from './commands/judge.js'
import { cmdMine } from './commands/mine.js'
import { cmdRecord } from './commands/record.js'
import { cmdDiff, cmdReport } from './commands/report.js'
import { evalsRoot, resolveEvalHome } from './paths.js'

/* v8 ignore start */
const usage = (repoRoot: string) => {
  console.log('사용법: eval <record|judge|mine|report> <인자>  (soohan-skills 레포 안: pnpm eval …, 밖: npx tsx <이 파일> …)')
  console.log('  record <plugin:skill | SKILL.md 경로> [--runtime=claude|codex] [--resume=<runId>]')
  console.log('  judge <runId>')
  console.log('  mine <plugin:skill | SKILL.md 경로>')
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
  const repoRoot = resolveEvalHome(process.cwd())
  const [sub, arg] = process.argv.slice(2)
  try {
    if (sub === 'record' && arg) await cmdRecord(arg, repoRoot, process.argv.slice(4))
    else if (sub === 'report' && arg === '--diff') cmdDiff(process.argv[4], process.argv[5], repoRoot)
    else if (sub === 'report' && arg) cmdReport(arg, repoRoot)
    else if (sub === 'judge' && arg) await cmdJudge(arg, repoRoot)
    else if (sub === 'mine' && arg) await cmdMine(arg, repoRoot)
    else { usage(repoRoot); process.exit(1) }
  } catch (e) {
    // 케이스 파일 문법 오류·경로 해석 실패는 사용자가 고칠 입력 문제다. 스택 트레이스는
    // 고칠 곳을 가리지 않으므로 메시지만 보여준다.
    console.error(`✗ ${(e as Error).message}`)
    process.exit(1)
  }
}
/* v8 ignore stop */
