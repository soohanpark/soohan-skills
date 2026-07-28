import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { casesDrifted, hashCases, loadCases, type EvalCase } from '../cases.js'
import type { ParsedRun } from '../parse.js'
import { parseClaudeStream, parseCodexStream } from '../parse.js'
import { casesFile, evalsRoot, resolveSkill, runDirName, skillMdExists } from '../paths.js'
import { planRuns, recordAll, type PlanItem, type RuntimeName } from '../record.js'
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
// 모르는 플래그는 던진다 — --reusme 같은 오타가 조용히 새 런을 처음부터 돌리면 안 된다 (재검증 리뷰 3).
export const parseRecordFlags = (flags: string[]): { runtime?: string; resume?: string } => {
  const isKnown = (f: string) =>
    f.startsWith('--runtime=') || f === 'claude' || f === 'codex' || f.startsWith('--resume=')
  const unknown = flags.find(f => !isKnown(f))
  if (unknown) {
    throw new Error(`알 수 없는 플래그 "${unknown}" — --runtime=claude|codex, --resume=<runId> 만 받습니다.`)
  }
  return {
    runtime: flags.find(f => f.startsWith('--runtime=') || f === 'claude' || f === 'codex'),
    resume: flags.find(f => f.startsWith('--resume='))?.slice('--resume='.length)
  }
}

// --resume 대상의 meta 와 이번 호출 인자가 맞물리는지 검증하고 재개 런타임을 정한다 (순수 — 테스트 대상).
// 다른 스킬의 런을 이어받으면 기존 원본이 엉뚱한 skillId/파서로 재해석되고 meta 가 덮인다 (재검증 리뷰 3).
export const checkResume = (
  meta: { skillId?: string; runtime?: RuntimeName; casesHash?: string },
  skillId: string,
  runtimeFlag?: string,
  casesHash?: string
): RuntimeName => {
  if (meta.skillId && meta.skillId !== skillId) {
    throw new Error(`--resume 대상은 ${meta.skillId} 의 실행입니다 — ${skillId} 로 이어갈 수 없습니다.`)
  }
  // 재개는 이미 적재된 원본을 그대로 재파싱한다. 그 사이 케이스를 고치면 옛 프롬프트에 대한
  // 응답이 새 프롬프트의 측정 결과로 index 에 들어가고, 지문은 새 값으로 덮여 흔적조차 안 남는다.
  if (casesHash !== undefined && casesDrifted(meta.casesHash, casesHash)) {
    throw new Error('--resume 대상을 기록한 뒤 케이스 파일이 바뀌었습니다 — 이미 적재된 실행은 옛 케이스의 결과입니다. 새 runId 로 기록하세요.')
  }
  const resumed = meta.runtime ?? 'claude'
  if (runtimeFlag && parseRuntimeFlag(runtimeFlag, resumed) !== resumed) {
    throw new Error(`--runtime 이 재개 대상의 런타임(${resumed})과 다릅니다 — 재개는 원 실행의 런타임을 따릅니다.`)
  }
  return resumed
}

// "--runtime=codex" 또는 맨 이름 "codex" → 'codex'. 미지정이면 감지된 런타임.
// 명시했는데 못 알아듣는 값이면 던진다 — 오타 난 채 수 분짜리 레코딩이 도는 걸 막는다 (리뷰 R12).
export const parseRuntimeFlag = (flag: string | undefined, detected: RuntimeName): RuntimeName => {
  if (!flag) return detected
  const name = flag.startsWith('--runtime=') ? flag.slice('--runtime='.length) : flag
  if (name !== 'claude' && name !== 'codex') {
    throw new Error(`알 수 없는 런타임 "${name}" — claude 또는 codex 만 지원합니다.`)
  }
  return name
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
  // 존재하지 않는 디렉터리로 계속 가면 forced 변형이 존재하지 않는 슬래시 커맨드를 부르고,
  // 그 변형은 턴·도구 제한이 없어 측정 대신 전권 도구로 프롬프트만 자유 실행된다.
  if (!skillMdExists(skill)) {
    console.error(`✗ ${skill.dir}/SKILL.md 가 없습니다 — "${skillArg}" 가 ${skill.id} 로 해석됐습니다.`)
    console.error('  측정 대상 SKILL.md 가 든 디렉터리 경로를 직접 넘기세요.')
    process.exit(1)
  }
  const file = casesFile(repoRoot, skill.id)
  if (!existsSync(file)) {
    console.error(`✗ ${file} 가 없습니다. 먼저 'eval mine ${skillArg}' 를 돌리고 draft를 승격하세요.`)
    process.exit(1)
  }

  const { runtime: runtimeFlag, resume } = parseRecordFlags(flags)
  const cases = loadCases(file)
  const casesHash = hashCases(cases)
  const runId = resume ?? runDirName(skill.id, new Date())
  let runtimeName = parseRuntimeFlag(runtimeFlag, detectRuntime())
  if (resume) {
    const metaFile = join(evalsRoot(repoRoot), 'runs', runId, 'meta.json')
    if (!existsSync(metaFile)) {
      console.error(`✗ runs/${runId} 에 meta.json 이 없습니다 — --resume 은 기존 runId 만 받습니다.`)
      process.exit(1)
    }
    try {
      runtimeName = checkResume(JSON.parse(readFileSync(metaFile, 'utf8')), skill.id, runtimeFlag, casesHash)
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`)
      process.exit(1)
    }
  }

  const runtime = RUNTIMES[runtimeName]
  const plan = buildRecordPlan(cases, runtime.qualityVariants)
  const res = await recordAll({
    plan, skill, casesHash,
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
