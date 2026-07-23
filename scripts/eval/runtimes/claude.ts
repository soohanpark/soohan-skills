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

export type Exec = (args: string[]) => Promise<{ stdout: string; durationMs: number }>

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

  throw new Error(`variant "forced" is not implemented yet`)
}

/* v8 ignore start */
export const execClaude: Exec = (args) =>
  new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', d => { stdout += d })
    child.on('error', reject)
    child.on('close', () => resolve({ stdout, durationMs: Date.now() - started }))
  })
/* v8 ignore stop */
