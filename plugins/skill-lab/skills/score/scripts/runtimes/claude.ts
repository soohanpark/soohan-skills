import { spawn } from 'node:child_process'

// 검증 결과: Read(<dir>/**) deny 패턴이 -p 모드에서 동작하지 않음.
// degradedBaseline(Read/Grep/Glob 전면 차단)을 기본으로 사용한다.

export type Variant = 'with' | 'forced' | 'without'

export interface SkillRef {
  id: string   // "plugin:skill"
  dir: string  // SKILL.md 가 든 디렉터리의 절대경로
  pluginRoot?: string  // .claude-plugin/plugin.json 이 있는 플러그인 루트 — 격리 로드(--plugin-dir)용. 개인 스킬엔 없다.
}

export interface BuildOptions {
  degradedBaseline?: boolean
  // forced 변형에 프롬프트로 직접 주입할 SKILL.md 전문. 실측(2026-07-30, CLI 2.1.220):
  // -p 모드의 슬래시 커맨드는 "로드했다"는 메시지만 남기고 본문을 컨텍스트에 넣지 않는다.
  // 격리 전에는 계정의 Bash(*) 허용이 모델의 자가-읽기 폴백을 지탱해 티가 안 났을 뿐이다.
  skillMd?: string
}

// 본문을 하네스가 직접 넣으면 "본문이 컨텍스트에 있다"가 구성상 보장된다 — Skill tool_use
// 블록 유무로 발동을 재는 비결정적 검사(같은 명령이 블록 없이 체크리스트만 따른 사례 실측)가
// 통째로 불필요해진다. 참조 파일 경로를 함께 알려 상대 참조가 풀리게 한다.
export const buildForcedPrompt = (skill: SkillRef, skillMd: string, prompt: string): string => `
아래는 이 요청에 사용할 스킬 "${skill.id}"의 지침 전문이다. 이 지침을 따라 요청을 수행하라.
스킬의 참조 파일들은 ${skill.dir} 에 있다.

<skill-instructions>
${skillMd}
</skill-instructions>

## 요청
${prompt}
`.trim()

export interface ExecOutcome {
  stdout: string
  exitCode: number | null
  stderr: string
}

export interface ExecOptions {
  cwd?: string  // 격리 모드가 실행마다 새 빈 디렉터리를 넘긴다. 없으면 부모 cwd 상속.
}

export type Exec = (args: string[], opts?: ExecOptions) => Promise<{ stdout: string; durationMs: number }>

// 종료 코드만으로는 판정할 수 없다: 트리거 축은 --max-turns 1 로 일부러 자르므로
// 정상 측정도 exit 1 로 끝난다. 인증 실패·API 오류는 result 이벤트를 남기므로
// 파서가 분류한다. 파서가 볼 것이 아무것도 없을 때만 실패로 올린다.
// cli 는 메시지에 찍힐 도구 이름이다 — execCodex 가 이 함수를 그대로 재사용하면서
// "claude produced no output" 으로 오도되지 않도록 파라미터화했다 (Task 12).
export const execFailureReason = (outcome: ExecOutcome, cli: string = 'claude'): string | null => {
  if (outcome.stdout.trim() !== '') return null
  const code = outcome.exitCode === null ? 'signal' : `exit ${outcome.exitCode}`
  const detail = outcome.stderr.trim() === '' ? '' : `: ${outcome.stderr.trim().split('\n').slice(-3).join(' ')}`
  return `${cli} produced no output (${code})${detail}`
}

const STREAM_ARGS = ['--output-format', 'stream-json', '--verbose']

// 실행이 끝난 뒤에도 남는 일을 만들거나 이 프로세스 밖으로 나가는 내장 도구들. 측정에는
// 필요 없고, 무인으로 수십 번 반복되는 실행에서 잘못 불리면 되돌릴 수 없다.
// 읽기 전용 사촌(CronList·TaskGet·TaskList·TaskOutput)은 남겨둔다.
export const SIDE_EFFECT_TOOLS = [
  'CronCreate', 'CronDelete', 'RemoteTrigger', 'PushNotification', 'ScheduleWakeup',
  'SendMessage', 'Task', 'Workflow', 'TaskCreate', 'TaskUpdate', 'TaskStop',
  'DesignSync', 'EnterWorktree', 'ExitWorktree', 'Monitor'
]

// MCP 를 감싸는 스킬은 그 도구를 뺏으면 측정이 성립하지 않는다. 그때만 켜는 명시적 탈출구다.
export const sideEffectsAllowed = (): boolean =>
  process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS === '1'

export type IsolationLevel = 'full' | 'cwd' | 'off'

// 실측(2026-07-29, claude-code 2.1.220): 기본 헤드리스 세션에는 계정 전역 플러그인의 스킬
// 66개(superpowers 14개 포함)와 유저 CLAUDE.md·rules 가 로드된다. msuarcade:init 평가에서
// 트리거 실패 10건 중 9건이 superpowers 브레인스토밍 훅에 단 한 번뿐인 턴을 뺏겼다 —
// description 이 아니라 환경이 점수를 정했다. --setting-sources project 는 유저 스코프를
// 제외해 이를 전부 끊고(66→23 스킬, OAuth 유지 실측), --plugin-dir 는 측정 대상 플러그인만
// 명시 로드한다 — local-scope 플러그인이라 프로젝트 트리 안에서 돌아야 했던 제약도 함께 풀린다.
// --bare 는 더 강한 격리지만 OAuth/키체인을 안 읽어(ANTHROPIC_API_KEY 강제) 채택하지 않았다.
//
// 개인 스킬(~/.claude/skills)은 유저 스코프에 산다 — 스코프를 제외하면 측정 대상 자체가 안
// 실리므로 cwd 격리만 한다('cwd'). 부수효과 모드도 'cwd' 다: 도구를 실환경으로 여는 것과
// 실행마다 새 빈 폴더를 주는 것은 별개고, cwd 까지 공유하면 앞 런의 산출물이 뒷 런의 전제를
// 깬다 (실측 2026-07-30, init 1단계 가드가 이전 런의 산출물을 보고 거부). 'off' 는 codex
// 런타임과 이 필드가 생기기 전의 기록에만 남는다.
export const isolationLevel = (skill: SkillRef): IsolationLevel =>
  sideEffectsAllowed() ? 'cwd' : skill.pluginRoot ? 'full' : 'cwd'

// 세 변형이 요구하는 환경은 서로 다르다 (실측 2026-07-30, msuarcade·superpowers 리포트):
//  - with    대상 플러그인 전체(훅 포함)가 후보에 있어야 트리거가 성립한다.
//  - forced  스킬이 실제로 일해야 한다 — 참조 파일·애셋이 플러그인 디렉터리에 있으므로
//            --add-dir 로 연다 (Read·Bash 접근을 함께 열고, 그 디렉터리의 CLAUDE.md 는 주입되지
//            않음을 실측 확인. 임시 cwd 에 설정을 심는 방식은 미신뢰 워크스페이스라 무시된다).
//  - without 대조군은 스킬의 어떤 흔적도 몰라야 한다. --plugin-dir 는 훅·스킬 목록까지 실어서,
//            baseline 이 훅으로 스킬의 교리를 주입받은 채 답하면 페어와이즈 델타가 0에 눌린다.
//            플러그인 자체를 싣지 않으면 훅 차단 설정도 따로 필요 없다.
// 품질 변형(forced·without)은 스킬/모델이 실제로 일해야 한다. 헤드리스 기본 권한은 git 등
// 임의 Bash 명령과 파일 쓰기를 승인 대기로 즉시 거부한다 — 실측(2026-07-31 스모크): forced 가
// git --version 거부에 막혀 절차를 시작하지 못했다. 격리 전에는 계정 설정의 Bash(*) 허용이
// 이 요구를 몰래 채우고 있었다. 명시 허용으로 그 조건을 재현한다 — 위험 표면은 그대로다:
// SIDE_EFFECT_TOOLS 는 --disallowedTools 로 막혀 있고(거부가 허용에 우선), MCP 는
// --strict-mcp-config 로 끊겨 있으며, cwd 는 일회용 임시 디렉터리다. 트리거 변형(with)에는
// 주지 않는다 — 권한 표면이 넓어지면 발동 행동 자체가 달라질 수 있다.
const QUALITY_TOOL_ALLOWS = ['Bash(*)', 'Write', 'Edit', 'NotebookEdit']

const qualityToolArgs = (variant: Variant): string[] =>
  variant === 'with'
    ? []
    : ['--allowedTools', ...QUALITY_TOOL_ALLOWS, ...(variant === 'forced' ? ['Read'] : [])]

// 개인 스킬(pluginRoot 없음)은 유저 스코프 유지가 전제라 --setting-sources 를 걸지 않는다.
const isolationArgs = (variant: Variant, skill: SkillRef): string[] => {
  if (sideEffectsAllowed()) return []
  const args: string[] = []
  if (skill.pluginRoot) {
    args.push('--setting-sources', 'project')
    if (variant !== 'without') args.push('--plugin-dir', skill.pluginRoot)
  }
  if (variant === 'forced') args.push('--add-dir', skill.pluginRoot ?? skill.dir)
  return args
}

// 실측(2026-07-29, claude-code 2.1.220): 헤드리스 -p 는 세션의 도구 레지스트리를 그대로
// 상속한다 — 기본 149개 중 116개가 연결된 MCP 서버였고, Gmail·Slack·Notion·Drive 의 쓰기
// 도구까지 열려 있었다. 실제 측정 중 회사 Slack MCP 가 호출된 사례가 보고됐다.
// --strict-mcp-config 를 --mcp-config 없이 주면 MCP 가 전부 끊긴다 (149→30 실측).
// 여기에 위 목록을 더하면 15개가 남는다 — Bash·Read·Write·Edit·Skill·WebSearch 는 살아 있어서
// 스킬이 일할 능력은 그대로다. 능력을 뺏으면 도구가 없어서 진 것을 품질로 읽게 된다.
// --disallowedTools 는 가변인자라 두 번 넘기면 파싱이 어긋난다 — 반드시 한 번에 합쳐서 넘긴다.
const restrictionArgs = (extraDenied: string[]): string[] => {
  const denied = sideEffectsAllowed() ? extraDenied : [...SIDE_EFFECT_TOOLS, ...extraDenied]
  return [
    ...(sideEffectsAllowed() ? [] : ['--strict-mcp-config']),
    ...(denied.length > 0 ? ['--disallowedTools', ...denied] : [])
  ]
}

// 한 턴짜리 텍스트 응답만 필요한 호출용 인자 — 심판 판정과 프롬프트 증강이 여기 해당한다.
// 둘 다 프롬프트에 신뢰할 수 없는 입력(녹화 트랜스크립트 · 채굴한 실사용 발화)을 그대로
// 끼워 넣으므로 인젝션 표면이다. 도구가 필요 없으니 턴과 도구를 함께 잠근다.
// 유저 스코프도 제외한다 — 심판 컨텍스트에 계정 CLAUDE.md·rules 가 주입되면 판정이 흔들린다.
// 두 곳이 각자 목록을 들면 한쪽만 갱신되어 조용히 어긋난다 — 한 군데서 만든다.
export const buildTextOnlyArgs = (prompt: string): string[] => [
  '-p', prompt, '--output-format', 'stream-json', '--verbose',
  '--max-turns', '1',
  '--strict-mcp-config',
  '--setting-sources', 'project',
  '--disallowedTools',
  'Skill', 'Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'WebFetch', 'WebSearch',
  ...SIDE_EFFECT_TOOLS
]

export const buildArgs = (
  variant: Variant,
  skill: SkillRef,
  prompt: string,
  opts: BuildOptions = {}
): string[] => {
  if (variant === 'with') {
    // 정찰 한 턴을 허용한다. 1턴 제한의 실측(2026-07-30, msuarcade:init): 54런 중 47런이
    // 첫 턴을 폴더 정찰(ls)에 쓰고 잘려 미발동으로 집계됐다 — 트리거가 "첫 턴에 결정"된다는
    // 전제가 전제 검증을 유도하는 description 부류에서 성립하지 않는다. 2턴이면 정찰 → 발동이
    // 담기고, 그 뒤 실행은 여전히 낭비이므로 자른다. 정찰 여부는 파서가 따로 센다.
    return ['-p', prompt, ...STREAM_ARGS, '--max-turns', '2', ...restrictionArgs([]), ...isolationArgs('with', skill)]
  }

  if (variant === 'without') {
    // Skill 툴만 막으면 모델이 Read 로 SKILL.md 를 직접 연다 (설계 §3-2)
    const denied = opts.degradedBaseline
      ? ['Skill', 'Read', 'Grep', 'Glob']
      : ['Skill', `Read(${skill.dir}/**)`]
    return ['-p', prompt, ...STREAM_ARGS, ...qualityToolArgs('without'), ...restrictionArgs(denied), ...isolationArgs('without', skill)]
  }

  // 본문이 주어지면 프롬프트에 직접 주입한다. 슬래시 폴백은 본문을 못 읽는 호출부(구 경로)용 —
  // 검증(2026-07-24): claude -p "/plugin:skill ..." 가 -p 모드에서도 Skill tool_use 는 발동시킨다.
  const forcedPrompt = opts.skillMd ? buildForcedPrompt(skill, opts.skillMd, prompt) : `/${skill.id} ${prompt}`
  return ['-p', forcedPrompt, ...STREAM_ARGS, ...qualityToolArgs('forced'), ...restrictionArgs([]), ...isolationArgs('forced', skill)]
}

const DEFAULT_TIMEOUT_MS = 600_000

// claude/codex 공용 spawn 래퍼. wall-clock 타임아웃이 핵심이다: without 변형은 턴 제한이
// 없어 CLI 하나가 멈추면 런 전체가 무한 대기한다. 타임아웃은 파일을 안 남기고 reject 되므로
// resume 이 나중에 재시도할 수 있다. 한도는 SKILL_EVAL_TIMEOUT_MS 로 조절한다.
// ponytail: SIGTERM 한 방 — 두 CLI 모두 TERM 에 죽는다. 안 죽는 사례가 보이면 SIGKILL 에스컬레이션 추가.
export const makeExec = (cli: string, timeoutMs?: number): Exec => (args, opts) =>
  new Promise((resolve, reject) => {
    const limit = timeoutMs ?? Number(process.env.SKILL_EVAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
    const started = Date.now()
    const child = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts?.cwd,
      env: { ...process.env, SKILL_EVAL_DEPTH: String(Number(process.env.SKILL_EVAL_DEPTH ?? '0') + 1) }
    })
    let stdout = ''
    let stderr = ''
    // 데드라인에서 즉시 reject 한다 — close 를 기다리면 SIGTERM 을 무시하는 자식이나
    // stdout 파이프를 물려받은 손자 프로세스가 살아 있는 한 close 가 안 와서 다시 무한 대기다
    // (재검증 리뷰 1). 이미 settle 된 promise 라 뒤늦은 close 의 resolve/reject 는 무해하다.
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${cli} timed out after ${limit}ms`))
    }, limit)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const outcome: ExecOutcome = { stdout, exitCode, stderr }
      const failure = execFailureReason(outcome, cli)
      if (failure) {
        reject(new Error(failure))
      } else {
        resolve({ stdout, durationMs: Date.now() - started })
      }
    })
  })

export const execClaude: Exec = makeExec('claude')
