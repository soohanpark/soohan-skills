import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EvalCase } from './cases.js'
import { parseClaudeStream, type ParsedRun } from './parse.js'
import { buildArgs, type BuildOptions, type Exec, type IsolationLevel, type SkillRef, type Variant } from './runtimes/claude.js'

export interface PlanItem {
  caseId: string
  prompt: string
  variant: Variant
  repeat: number
  file: string
}

export type RuntimeName = 'claude' | 'codex'

export interface RunMeta {
  runId: string
  skillId: string
  skillDir: string   // 외부 경로 스킬도 judge 가 SKILL.md 를 찾을 수 있어야 한다 (리뷰 R4)
  model: string
  judgeModel: string | null
  loadedSkills: string[]
  repoSha: string
  casesHash: string
  startedAt: string
  degradedBaseline: boolean
  runtime: RuntimeName
  // 이 실행이 MCP·외부 작용 도구를 열어둔 채 돌았는가. 측정 조건이 파일에 남아야
  // 나중에 리포트를 읽는 사람이 그 점수의 도달 범위를 알 수 있다.
  sideEffectsAllowed: boolean
  // 격리 수준도 같은 이유로 남긴다 — 비격리 트리거 축은 계정의 전역 스킬·훅과 경쟁한
  // 결과라, 점수를 읽는 사람이 그 사실을 모르면 미발동을 description 탓으로 오독한다.
  isolation: IsolationLevel
  // forced 프롬프트에 SKILL.md 본문이 주입됐는가. 주입 런은 "본문이 컨텍스트에 있음"이
  // 구성상 보장되므로 채점이 Skill tool_use 발동 검사를 요구하면 안 된다 — 채점 시점에
  // 이 조건을 알려면 파일에 남아야 한다.
  forcedBodyInjected: boolean
  // 대상 플러그인이 훅을 싣는가. 참이면 트리거 축은 description 단독이 아니라
  // "플러그인 전체(훅 포함) 발동률"이다 — 리포트가 그렇게 라벨한다.
  pluginHasHooks: boolean
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
  reconToolCalls: null,
  skillReadFallback: false,
  finalText: '',
  // makeExec 의 wall-clock 킬만 이 메시지를 만든다 — 양끝 앵커로 정확히 그 메시지만 잡는다.
  // stderr 꼬리가 접혀 들어간 "... Request timed out after 30000ms" 류는 error 로 남는다 (재검증 리뷰 4)
  status: /^\S+ timed out after \d+ms$/.test(reason) ? 'timeout' : 'error',
  terminalReason: reason,
  tokens: 0,
  truncated: false,
  permissionDenials: [],
  costUsd: 0,
  model: '',
  loadedSkills: []
})

// rate limit·overload·연결 오류만 일시적이다. 인증 실패·max_turns 는 재시도해도 결과가 같으므로 대상에서 뺀다 (설계 §10)
const TRANSIENT = /rate.?limit|overloaded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i

export const isTransient = (reason: string): boolean => TRANSIENT.test(reason)

// 파서가 종료 이벤트를 못 찾았을 때 내는 사유들 — 스트림이 잘렸다는 뜻이므로 재시도 대상이다.
const NO_RESULT_REASONS = new Set(['no_result_event', 'no_completion_event'])

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export const recordAll = async (args: {
  plan: PlanItem[]
  skill: SkillRef
  outDir: string
  exec: Exec
  degradedBaseline?: boolean
  repoSha?: string
  runtime?: RuntimeName
  casesHash?: string
  sideEffectsAllowed?: boolean
  isolation?: IsolationLevel
  // 측정 대상 SKILL.md 전문 — forced 변형의 프롬프트 주입용. 호출부(CLI 계층)가 읽어 넘긴다.
  skillMd?: string
  pluginHasHooks?: boolean
  // 재측정할 케이스 id 목록. 지정 케이스는 기존 기록을 덮어쓰고, 나머지는 기존 기록만
  // index 로 재구성한다 — 기록 없는 케이스는 index 에서도 빠져 report 가 notRun 으로 잡는다.
  only?: string[]
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
  const isolation = args.isolation ?? 'off'
  const sleep = args.sleep ?? defaultSleep
  // 런타임 어댑터 주입 지점 — 기본은 claude. 기존 호출부는 둘 다 생략하므로 동작이 그대로다 (Task 12).
  const buildArgsFn = args.buildArgsFn ?? buildArgs
  const parse = args.parse ?? parseClaudeStream
  mkdirSync(outDir, { recursive: true })

  const index: IndexEntry[] = []
  let written = 0
  let skipped = 0
  let errors = 0
  const startedAt = new Date().toISOString()

  // index/meta 를 매 항목마다 갱신한다. 예전에는 루프를 다 돈 뒤에야 썼기 때문에, 60건짜리
  // 실행이 40번째에서 끊기면 원본 40개는 디스크에 남고 meta.json 만 없어서 --resume 이
  // "meta.json 이 없습니다" 로 거부했다 — 재개가 가장 필요한 상황에서 정확히 못 쓰는 상태였다.
  // 파일이 작아 매번 쓰는 비용은 CLI 한 번의 왕복에 비하면 없는 것과 같다.
  const persistIndex = () => {
    const first = index.find(e => e.parsed.model !== '')
    const meta: RunMeta = {
      runId: outDir.split('/').pop() ?? outDir,
      skillId: skill.id,
      skillDir: skill.dir,
      model: first?.parsed.model ?? '',
      judgeModel: null,
      loadedSkills: first?.parsed.loadedSkills ?? [],
      repoSha: args.repoSha ?? '',
      casesHash: args.casesHash ??
        createHash('sha256').update(plan.map(p => p.caseId + p.prompt).join('\n')).digest('hex').slice(0, 12),
      startedAt,
      degradedBaseline: args.degradedBaseline ?? true,
      runtime: args.runtime ?? 'claude',
      sideEffectsAllowed: args.sideEffectsAllowed ?? false,
      isolation,
      forcedBodyInjected: args.skillMd !== undefined,
      pluginHasHooks: args.pluginHasHooks ?? false
    }
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2))
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
  }
  persistIndex()

  for (const item of plan) {
    const target = join(outDir, item.file)
    // only 는 재측정 요청이다 — 지정 케이스는 기존 기록이 있어도 다시 실행해 덮어쓴다.
    const rerunRequested = args.only !== undefined && args.only.includes(item.caseId)
    const outOfScope = args.only !== undefined && !args.only.includes(item.caseId)
    if (existsSync(target) && !rerunRequested) {
      // 이전 호출에서 이미 적재된 항목이다 — 재실행하지 않되, 원본을 다시 읽어
      // index 에는 온전한 엔트리로 남긴다. 그렇지 않으면 재개된 실행의 index.json 이
      // 이번 호출분만 담아 이전 결과를 통째로 잃는다.
      skipped += 1
      const raw = readFileSync(target, 'utf8')
      const parsed = parse(raw, { skillId: skill.id, skillDir: skill.dir })
      if (parsed.status !== 'ok') errors += 1
      index.push({ ...item, durationMs: 0, parsed })
      persistIndex()
      continue
    }
    // 범위 밖 + 기록 없음 — 실행도 index 도 없다. report 가 notRun(판정 불가)으로 잡는다.
    if (outOfScope) continue

    const attempt = async (): Promise<{ parsed: ParsedRun; stdout: string | null; durationMs: number }> => {
      // 격리 모드는 실행마다 새 빈 디렉터리를 파서 CLI 의 cwd 로 준다. 실제 워크스페이스에서
      // 돌리면 baseline 이 워크스페이스 문서를 뒤져 엉뚱한 답을 내고 프로젝트 CLAUDE.md 가
      // 첫 턴을 뺏는다(실측 2026-07-28·29). 디렉터리를 재사용하면 앞 실행의 산출물이 스킬의
      // "빈 폴더" 전제를 깬다 — 재시도까지 포함해 매번 새로 판다.
      const ws = isolation === 'off' ? null : mkdtempSync(join(tmpdir(), 'skill-eval-ws-'))
      try {
        // Task 3 Step 5 실측: Read(<dir>/**) deny 패턴은 -p 모드에서 무시된다.
        // 따라서 degraded(Read/Grep/Glob 전면 차단)가 baseline 의 기본값이다.
        const argv = buildArgsFn(item.variant, skill, item.prompt, {
          degradedBaseline: args.degradedBaseline ?? true,
          skillMd: args.skillMd
        })
        const { stdout, durationMs: ms } = await exec(argv, ws ? { cwd: ws } : undefined)
        return {
          parsed: parse(stdout, { skillId: skill.id, skillDir: skill.dir }),
          stdout,
          durationMs: ms
        }
      } catch (e) {
        // stdout: null — 원본 파일을 만들지 않는다는 뜻이다. 빈 파일을 남기면 다음 호출의
        // existsSync 가 이를 "완료됨"으로 오인해 일시적 실패를 영원히 재시도하지 못하게 막는다.
        return { parsed: errorRun((e as Error).message), stdout: null, durationMs: 0 }
      } finally {
        if (ws) rmSync(ws, { recursive: true, force: true })
      }
    }

    let result = await attempt()
    if (result.parsed.status !== 'ok' && isTransient(result.parsed.terminalReason)) {
      await sleep(2000) // 1회 지수 백오프. 판정은 replay 이므로 재시도 대상이 아니다 (설계 §10)
      result = await attempt()
    }

    // result 이벤트가 없는 stdout 은 잘린 스트림이다 (CLI 가 몇 줄 뱉고 죽은 경우).
    // 파일로 굳히면 다음 --resume 이 existsSync 로 건너뛰어 이 케이스는 영원히 에러로 남는다.
    // 남기지 않으면 재개가 다시 시도한다 — thrown exec 을 다루는 것과 같은 원칙이다.
    const truncatedStream = NO_RESULT_REASONS.has(result.parsed.terminalReason)
    if (result.stdout !== null && !truncatedStream) writeFileSync(target, result.stdout)
    const parsed = result.parsed
    const durationMs = result.durationMs

    written += 1
    if (parsed.status !== 'ok') errors += 1
    index.push({ ...item, durationMs, parsed })
    persistIndex()
  }

  persistIndex()

  // errorRate 는 이번 호출에서 실행된 항목뿐 아니라 재개로 재구성된 항목까지
  // index 전체를 분모로 삼는다 — "이 실행 결과 전체를 신뢰할 수 있는가"에 답해야 하므로.
  return { written, skipped, errorRate: index.length === 0 ? 0 : errors / index.length }
}
