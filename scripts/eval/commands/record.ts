import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases, type EvalCase } from '../cases.js'
import { casesFile, evalsRoot, resolveSkill, runDirName } from '../paths.js'
import { planRuns, recordAll } from '../record.js'
import { execClaude } from '../runtimes/claude.js'

// 실행 결과를 사람이 읽을 한 덩어리로 만든다 (순수 — 테스트 대상)
export const formatRecordSummary = (res: { written: number; skipped: number; errorRate: number }, runId: string): string => {
  const lines = [`기록 완료: ${res.written}건 실행, ${res.skipped}건 건너뜀, 에러율 ${Math.round(res.errorRate * 100)}%`]
  if (res.errorRate > 0.2) lines.push('⚠ 에러율 20% 초과 — 이 실행 결과는 신뢰할 수 없습니다.')
  lines.push(`runId: ${runId}`)
  return lines.join('\n')
}

/* v8 ignore start */
// record.ts 는 프로세스를 실행하지 않는다. repoSha 는 CLI 계층인 여기서 공급한다.
const currentSha = (repoRoot: string): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export const cmdRecord = async (skillArg: string, repoRoot: string): Promise<void> => {
  const skill = resolveSkill(skillArg, repoRoot)
  const file = casesFile(repoRoot, skill.id)
  if (!existsSync(file)) {
    console.error(`✗ ${file} 가 없습니다. 먼저 'pnpm eval mine ${skillArg}' 를 돌리고 draft를 승격하세요.`)
    process.exit(1)
  }
  const cases = loadCases(file)
  // 순수 트리거 케이스(must/must_not/qualitative 미선언)는 규칙/판정 대상이 될 수 없으므로
  // forced/without 실행을 아예 계획하지 않는다 — 매 record 실행마다 불필요한 라이브 CLI 호출을 낳던 부분.
  const isQuality = (c: EvalCase) => Boolean(c.must || c.must_not || c.qualitative)
  const plan = [
    ...planRuns(cases.filter(c => !isQuality(c)), { variants: ['with'], repeats: 3 }),
    ...planRuns(cases.filter(isQuality), { variants: ['with', 'forced', 'without'], repeats: 3 })
  ]
  const runId = runDirName(skill.id, new Date())
  const res = await recordAll({
    plan, skill,
    outDir: join(evalsRoot(repoRoot), 'runs', runId),
    exec: execClaude,
    repoSha: currentSha(repoRoot)
  })
  console.log(formatRecordSummary(res, runId))
}
/* v8 ignore stop */
