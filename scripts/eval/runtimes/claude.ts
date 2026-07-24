import { spawn } from 'node:child_process'

// 검증 결과: Read(<dir>/**) deny 패턴이 -p 모드에서 동작하지 않음.
// degradedBaseline(Read/Grep/Glob 전면 차단)을 기본으로 사용한다.

export type Variant = 'with' | 'forced' | 'without'

export interface SkillRef {
  id: string   // "plugin:skill"
  dir: string  // SKILL.md 가 든 디렉터리의 절대경로
}

export interface BuildOptions {
  degradedBaseline?: boolean
}

export interface ExecOutcome {
  stdout: string
  exitCode: number | null
  stderr: string
}

export type Exec = (args: string[]) => Promise<{ stdout: string; durationMs: number }>

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

export const buildArgs = (
  variant: Variant,
  skill: SkillRef,
  prompt: string,
  opts: BuildOptions = {}
): string[] => {
  if (variant === 'with') {
    // 트리거는 첫 턴에 결정되므로 그 뒤 실행은 전부 낭비다 (설계 §3-3)
    return ['-p', prompt, ...STREAM_ARGS, '--max-turns', '1']
  }

  if (variant === 'without') {
    // Skill 툴만 막으면 모델이 Read 로 SKILL.md 를 직접 연다 (설계 §3-2)
    const denied = opts.degradedBaseline
      ? ['Skill', 'Read', 'Grep', 'Glob']
      : ['Skill', `Read(${skill.dir}/**)`]
    return ['-p', prompt, '--disallowedTools', ...denied, ...STREAM_ARGS]
  }

  // 검증(2026-07-24): claude -p "/plugin:skill ..." 가 -p 모드에서도 Skill tool_use를
  // 실제로 발동시킨다 (stream-json에 "name":"Skill","input":{"skill":"<id>"} 확인).
  return ['-p', `/${skill.id} ${prompt}`, ...STREAM_ARGS]
}

const DEFAULT_TIMEOUT_MS = 600_000

// claude/codex 공용 spawn 래퍼. wall-clock 타임아웃이 핵심이다: without 변형은 턴 제한이
// 없어 CLI 하나가 멈추면 런 전체가 무한 대기한다. 타임아웃은 파일을 안 남기고 reject 되므로
// resume 이 나중에 재시도할 수 있다. 한도는 SKILL_EVAL_TIMEOUT_MS 로 조절한다.
// ponytail: SIGTERM 한 방 — 두 CLI 모두 TERM 에 죽는다. 안 죽는 사례가 보이면 SIGKILL 에스컬레이션 추가.
export const makeExec = (cli: string, timeoutMs?: number): Exec => (args) =>
  new Promise((resolve, reject) => {
    const limit = timeoutMs ?? Number(process.env.SKILL_EVAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
    const started = Date.now()
    const child = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SKILL_EVAL_DEPTH: String(Number(process.env.SKILL_EVAL_DEPTH ?? '0') + 1) }
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, limit)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`${cli} timed out after ${limit}ms`))
        return
      }
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
