import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases, type EvalCase } from '../cases.js'
import type { ParsedRun } from '../parse.js'
import { parseClaudeStream, parseCodexStream } from '../parse.js'
import { casesFile, evalsRoot, resolveSkill, runDirName } from '../paths.js'
import { planRuns, recordAll, type PlanItem } from '../record.js'
import { buildArgs, execClaude, type BuildOptions, type Exec, type SkillRef, type Variant } from '../runtimes/claude.js'
import { buildCodexArgs, execCodex } from '../runtimes/codex.js'

// 실행 결과를 사람이 읽을 한 덩어리로 만든다 (순수 — 테스트 대상)
export const formatRecordSummary = (res: { written: number; skipped: number; errorRate: number }, runId: string): string => {
  const lines = [`기록 완료: ${res.written}건 실행, ${res.skipped}건 건너뜀, 에러율 ${Math.round(res.errorRate * 100)}%`]
  if (res.errorRate > 0.2) lines.push('⚠ 에러율 20% 초과 — 이 실행 결과는 신뢰할 수 없습니다.')
  lines.push(`runId: ${runId}`)
  return lines.join('\n')
}

// 품질 플래그(must/must_not/qualitative)가 붙은 케이스만 forced/without 을 받는다.
export const isQualityCase = (c: EvalCase): boolean => Boolean(c.must || c.must_not || c.qualitative)

export const buildRecordPlan = (
  cases: EvalCase[],
  qualityVariants: Variant[] = ['with', 'forced', 'without']
): PlanItem[] => [
  ...planRuns(cases.filter(c => !isQualityCase(c)), { variants: ['with'], repeats: 3 }),
  ...planRuns(cases.filter(isQualityCase), { variants: qualityVariants, repeats: 3 })
]

// ponytail: also duplicated as record.ts's own RuntimeName (to dodge the import cycle back to
// here) — keep both in sync if a third runtime is ever added.
export type RuntimeName = 'claude' | 'codex'

export interface RuntimeAdapter {
  name: RuntimeName
  exec: Exec
  buildArgs: (v: Variant, skill: SkillRef, prompt: string, opts?: BuildOptions) => string[]
  parse: (raw: string, opts: { skillId: string; skillDir: string }) => ParsedRun
  qualityVariants: Variant[]
}

// codex 는 without(무개입) baseline 을 못 만든다 — CODEX_HOME 격리가 인증을 깨뜨린다
// (실측, buildCodexArgs 참고). with/forced 축만 돈다.
export const RUNTIMES: Record<RuntimeName, RuntimeAdapter> = {
  claude: {
    name: 'claude',
    exec: execClaude,
    buildArgs,
    parse: parseClaudeStream,
    qualityVariants: ['with', 'forced', 'without']
  },
  codex: {
    name: 'codex',
    exec: execCodex,
    buildArgs: buildCodexArgs,
    parse: parseCodexStream,
    qualityVariants: ['with', 'forced']
  }
}

// record 서브커맨드의 나머지 argv 에서 두 플래그를 골라낸다 (순수 — 테스트 대상).
export const parseRecordFlags = (flags: string[]): { runtime?: string; resume?: string } => ({
  runtime: flags.find(f => f.startsWith('--runtime=') || f === 'claude' || f === 'codex'),
  resume: flags.find(f => f.startsWith('--resume='))?.slice('--resume='.length)
})

// "--runtime=codex" 또는 맨 이름 "codex" → 'codex'. 미지정·미인식 값은 감지된 런타임으로 되돌아간다.
export const parseRuntimeFlag = (flag: string | undefined, detected: RuntimeName): RuntimeName => {
  if (!flag) return detected
  const name = flag.startsWith('--runtime=') ? flag.slice('--runtime='.length) : flag
  return name === 'claude' || name === 'codex' ? name : detected
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

// 설치된 CLI 를 감지한다 — 실제로 which 를 실행하므로 ignore 블록 안에 둔다. claude 를 우선한다.
const detectRuntime = (): RuntimeName => {
  for (const name of ['claude', 'codex'] as const) {
    try {
      execFileSync('which', [name], { stdio: 'ignore' })
      return name
    } catch {
      // 설치돼 있지 않다 — 다음 후보로 넘어간다
    }
  }
  return 'claude'
}

export const cmdRecord = async (skillArg: string, repoRoot: string, flags: string[] = []): Promise<void> => {
  const skill = resolveSkill(skillArg, repoRoot)
  const file = casesFile(repoRoot, skill.id)
  if (!existsSync(file)) {
    console.error(`✗ ${file} 가 없습니다. 먼저 'pnpm eval mine ${skillArg}' 를 돌리고 draft를 승격하세요.`)
    process.exit(1)
  }

  const { runtime: runtimeFlag, resume } = parseRecordFlags(flags)
  const runId = resume ?? runDirName(skill.id, new Date())
  let runtimeName = parseRuntimeFlag(runtimeFlag, detectRuntime())
  if (resume) {
    const metaFile = join(evalsRoot(repoRoot), 'runs', runId, 'meta.json')
    if (!existsSync(metaFile)) {
      console.error(`✗ runs/${runId} 에 meta.json 이 없습니다 — --resume 은 기존 runId 만 받습니다.`)
      process.exit(1)
    }
    // 재개는 원 실행의 런타임을 따른다 — 다른 파서로 기존 원본을 재해석하면 결과가 오염된다.
    runtimeName = (JSON.parse(readFileSync(metaFile, 'utf8')) as { runtime?: RuntimeName }).runtime ?? 'claude'
  }

  const runtime = RUNTIMES[runtimeName]
  const plan = buildRecordPlan(loadCases(file), runtime.qualityVariants)
  const res = await recordAll({
    plan, skill,
    outDir: join(evalsRoot(repoRoot), 'runs', runId),
    exec: runtime.exec,
    buildArgsFn: runtime.buildArgs,
    parse: runtime.parse,
    repoSha: currentSha(repoRoot),
    runtime: runtime.name
  })
  console.log(`런타임: ${runtime.name}`)
  console.log(formatRecordSummary(res, runId))
}
/* v8 ignore stop */
