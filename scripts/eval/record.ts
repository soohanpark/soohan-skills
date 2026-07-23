import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvalCase } from './cases.js'
import { parseClaudeStream, type ParsedRun } from './parse.js'
import { buildArgs, type Exec, type SkillRef, type Variant } from './runtimes/claude.js'

export interface PlanItem {
  caseId: string
  prompt: string
  variant: Variant
  repeat: number
  file: string
}

export interface RunMeta {
  runId: string
  skillId: string
  model: string
  judgeModel: string | null
  loadedSkills: string[]
  casesHash: string
  startedAt: string
  degradedBaseline: boolean
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

export const recordAll = async (args: {
  plan: PlanItem[]
  skill: SkillRef
  outDir: string
  exec: Exec
  degradedBaseline?: boolean
}): Promise<{ written: number; skipped: number; errorRate: number }> => {
  const { plan, skill, outDir, exec } = args
  mkdirSync(outDir, { recursive: true })

  const index: IndexEntry[] = []
  let written = 0
  let skipped = 0
  let errors = 0

  for (const item of plan) {
    const target = join(outDir, item.file)
    if (existsSync(target)) {
      skipped += 1
      continue
    }

    let parsed: ParsedRun
    let durationMs = 0
    try {
      // Task 3 Step 5 실측: Read(<dir>/**) deny 패턴은 -p 모드에서 무시된다.
      // 따라서 degraded(Read/Grep/Glob 전면 차단)가 baseline 의 기본값이다.
      const argv = buildArgs(item.variant, skill, item.prompt, {
        degradedBaseline: args.degradedBaseline ?? true
      })
      const { stdout, durationMs: ms } = await exec(argv)
      durationMs = ms
      writeFileSync(target, stdout)
      parsed = parseClaudeStream(stdout, { skillId: skill.id, skillDir: skill.dir })
    } catch (e) {
      parsed = errorRun((e as Error).message)
      writeFileSync(target, '')
    }

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
    casesHash: createHash('sha256').update(plan.map(p => p.caseId + p.prompt).join('\n')).digest('hex').slice(0, 12),
    startedAt: new Date().toISOString(),
    degradedBaseline: args.degradedBaseline ?? true
  }

  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2))
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))

  return { written, skipped, errorRate: written === 0 ? 0 : errors / written }
}
