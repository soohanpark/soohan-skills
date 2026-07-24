import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvalCase } from './cases.js'
import { parseClaudeStream, type ParsedRun } from './parse.js'
import { buildArgs, type BuildOptions, type Exec, type SkillRef, type Variant } from './runtimes/claude.js'

export interface PlanItem {
  caseId: string
  prompt: string
  variant: Variant
  repeat: number
  file: string
}

// ponytail: duplicated (not imported) from commands/record.ts's RuntimeName to dodge an import
// cycle — commands/record.ts already imports recordAll/PlanItem from this file. Both are the
// same 2-member string union; keep them in sync if a third runtime is ever added.
export type RuntimeName = 'claude' | 'codex'

export interface RunMeta {
  runId: string
  skillId: string
  model: string
  judgeModel: string | null
  loadedSkills: string[]
  repoSha: string
  casesHash: string
  startedAt: string
  degradedBaseline: boolean
  runtime: RuntimeName
}

export interface IndexEntry {
  caseId: string
  variant: Variant
  repeat: number
  file: string
  durationMs: number
  parsed: ParsedRun
}

// 트리거 축만 반복이 필요하다. 품질 변형은 비싸고 반복해도 얻는 게 없다.
const REPEATED_VARIANTS = new Set<Variant>(['with'])

export const planRuns = (
  cases: EvalCase[],
  opts: { variants: Variant[]; repeats: number }
): PlanItem[] => {
  const items: PlanItem[] = []
  for (const c of cases) {
    for (const variant of opts.variants) {
      const times = REPEATED_VARIANTS.has(variant) ? opts.repeats : 1
      for (let r = 1; r <= times; r++) {
        items.push({
          caseId: c.id,
          prompt: c.prompt,
          variant,
          repeat: r,
          file: `${variant}--${c.id}--r${r}.jsonl`
        })
      }
    }
  }
  return items
}

const errorRun = (reason: string): ParsedRun => ({
  triggered: false,
  skillReadFallback: false,
  finalText: '',
  status: 'error',
  terminalReason: reason,
  tokens: 0,
  costUsd: 0,
  model: '',
  loadedSkills: []
})

// rate limit·overload·연결 오류만 일시적이다. 인증 실패·max_turns 는 재시도해도 결과가 같으므로 대상에서 뺀다 (설계 §10)
const TRANSIENT = /rate.?limit|overloaded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i

export const isTransient = (reason: string): boolean => TRANSIENT.test(reason)

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const recordAll = async (args: {
  plan: PlanItem[]
  skill: SkillRef
  outDir: string
  exec: Exec
  degradedBaseline?: boolean
  repoSha?: string
  runtime?: RuntimeName
  sleep?: (ms: number) => Promise<void>
  buildArgsFn?: (v: Variant, skill: SkillRef, prompt: string, opts?: BuildOptions) => string[]
  parse?: (raw: string, opts: { skillId: string; skillDir: string }) => ParsedRun
}): Promise<{ written: number; skipped: number; errorRate: number }> => {
  // skill-eval 을 forced 로 돌리면 그 안에서 다시 러너를 부른다. 한 단계에서 끊는다 (설계 §9)
  const depth = Number(process.env.SKILL_EVAL_DEPTH ?? '0')
  if (depth > 0) {
    throw new Error(`SKILL_EVAL_DEPTH=${depth} — 중첩 실행을 차단했습니다. 도그푸딩 재귀입니다.`)
  }

  const { plan, skill, outDir, exec } = args
  const sleep = args.sleep ?? defaultSleep
  // 런타임 어댑터 주입 지점 — 기본은 claude. 기존 호출부는 둘 다 생략하므로 동작이 그대로다 (Task 12).
  const buildArgsFn = args.buildArgsFn ?? buildArgs
  const parse = args.parse ?? parseClaudeStream
  mkdirSync(outDir, { recursive: true })

  const index: IndexEntry[] = []
  let written = 0
  let skipped = 0
  let errors = 0

  for (const item of plan) {
    const target = join(outDir, item.file)
    if (existsSync(target)) {
      // 이전 호출에서 이미 적재된 항목이다 — 재실행하지 않되, 원본을 다시 읽어
      // index 에는 온전한 엔트리로 남긴다. 그렇지 않으면 재개된 실행의 index.json 이
      // 이번 호출분만 담아 이전 결과를 통째로 잃는다.
      skipped += 1
      const raw = readFileSync(target, 'utf8')
      const parsed = parse(raw, { skillId: skill.id, skillDir: skill.dir })
      if (parsed.status !== 'ok') errors += 1
      index.push({ ...item, durationMs: 0, parsed })
      continue
    }

    const attempt = async (): Promise<{ parsed: ParsedRun; stdout: string | null; durationMs: number }> => {
      try {
        // Task 3 Step 5 실측: Read(<dir>/**) deny 패턴은 -p 모드에서 무시된다.
        // 따라서 degraded(Read/Grep/Glob 전면 차단)가 baseline 의 기본값이다.
        const argv = buildArgsFn(item.variant, skill, item.prompt, {
          degradedBaseline: args.degradedBaseline ?? true
        })
        const { stdout, durationMs: ms } = await exec(argv)
        return {
          parsed: parse(stdout, { skillId: skill.id, skillDir: skill.dir }),
          stdout,
          durationMs: ms
        }
      } catch (e) {
        // stdout: null — 원본 파일을 만들지 않는다는 뜻이다. 빈 파일을 남기면 다음 호출의
        // existsSync 가 이를 "완료됨"으로 오인해 일시적 실패를 영원히 재시도하지 못하게 막는다.
        return { parsed: errorRun((e as Error).message), stdout: null, durationMs: 0 }
      }
    }

    let result = await attempt()
    if (result.parsed.status !== 'ok' && isTransient(result.parsed.terminalReason)) {
      await sleep(2000) // 1회 지수 백오프. 판정은 replay 이므로 재시도 대상이 아니다 (설계 §10)
      result = await attempt()
    }

    if (result.stdout !== null) writeFileSync(target, result.stdout)
    const parsed = result.parsed
    const durationMs = result.durationMs

    written += 1
    if (parsed.status !== 'ok') errors += 1
    index.push({ ...item, durationMs, parsed })
  }

  const first = index.find(e => e.parsed.model !== '')
  const meta: RunMeta = {
    runId: outDir.split('/').pop() ?? outDir,
    skillId: skill.id,
    model: first?.parsed.model ?? '',
    judgeModel: null,
    loadedSkills: first?.parsed.loadedSkills ?? [],
    repoSha: args.repoSha ?? '',
    casesHash: createHash('sha256').update(plan.map(p => p.caseId + p.prompt).join('\n')).digest('hex').slice(0, 12),
    startedAt: new Date().toISOString(),
    degradedBaseline: args.degradedBaseline ?? true,
    runtime: args.runtime ?? 'claude'
  }

  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2))
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))

  // errorRate 는 이번 호출에서 실행된 항목뿐 아니라 재개로 재구성된 항목까지
  // index 전체를 분모로 삼는다 — "이 실행 결과 전체를 신뢰할 수 있는가"에 답해야 하므로.
  return { written, skipped, errorRate: index.length === 0 ? 0 : errors / index.length }
}
