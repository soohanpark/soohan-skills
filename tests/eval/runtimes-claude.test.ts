import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArgs, buildForcedPrompt, buildTextOnlyArgs, execFailureReason, isolationLevel, makeExec } from '../../plugins/skill-eval/skills/score/scripts/runtimes/claude'

const skill = { id: 'demo:write', dir: '/tmp/plugins/demo/skills/write' }

describe('buildArgs', () => {
  // 실측(2026-07-30, msuarcade:init): 1턴 제한에서 54런 중 47런이 첫 턴을 정찰(ls)에 쓰고
  // 잘려 미발동으로 집계됐다 — 6건은 "그 스킬을 쓰겠다"고 말한 채 잘렸다. 정찰 한 턴을 허용한다.
  it('builds the with-variant allowing one reconnaissance turn before the cut', () => {
    const args = buildArgs('with', skill, 'MR 써줘')
    expect(args).toContain('-p')
    expect(args).toContain('MR 써줘')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--verbose')
    expect(args).toEqual(expect.arrayContaining(['--max-turns', '2']))
  })

  it('does not restrict the skill\'s own working tools in the with-variant', () => {
    const args = buildArgs('with', skill, 'x')
    expect(args).not.toContain('Read')
    expect(args).not.toContain('Grep')
    expect(args).not.toContain('Glob')
  })

  it('blocks both the Skill tool and reads of the skill directory in the without-variant', () => {
    const args = buildArgs('without', skill, 'x')
    const i = args.indexOf('--disallowedTools')
    expect(i).toBeGreaterThan(-1)
    expect(args).toContain('Skill')
    expect(args).toContain(`Read(${skill.dir}/**)`)
  })

  it('does not cut turns in the without-variant — the baseline needs to finish', () => {
    const args = buildArgs('without', skill, 'x')
    expect(args).not.toContain('--max-turns')
  })

  it('falls back to blocking Read, Grep and Glob wholesale when degraded', () => {
    const args = buildArgs('without', skill, 'x', { degradedBaseline: true })
    expect(args).toContain('Skill')
    expect(args).toContain('Read')
    expect(args).toContain('Grep')
    expect(args).toContain('Glob')
    expect(args).not.toContain(`Read(${skill.dir}/**)`)
  })

  it('passes the prompt verbatim, including quotes and newlines', () => {
    const prompt = 'MR "본문" 써줘\n두 번째 줄'
    const args = buildArgs('with', skill, prompt)
    expect(args).toContain(prompt)
  })

  it('builds the forced variant so the skill is invoked directly', () => {
    const args = buildArgs('forced', skill, 'MR 써줘')
    expect(args).toContain('-p')
    expect(args.join(' ')).toContain('demo:write')
    expect(args).toContain('--verbose')
  })

  it('does not cut turns in the forced variant', () => {
    expect(buildArgs('forced', skill, 'x')).not.toContain('--max-turns')
  })
})

describe('makeExec', () => {
  it('resolves with stdout and duration for a process that completes', async () => {
    const exec = makeExec('echo', 5000)
    const r = await exec(['hello'])
    expect(r.stdout).toContain('hello')
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('kills a hung process and rejects naming the timeout', async () => {
    const exec = makeExec('sleep', 100)
    await expect(exec(['5'])).rejects.toThrow(/sleep timed out after 100ms/)
  })

  it('rejects with the cli name when the process produces no output', async () => {
    const exec = makeExec('true', 5000)
    await expect(exec([])).rejects.toThrow(/true produced no output/)
  })

  it('rejects at the deadline even when the child ignores SIGTERM — close may never come', async () => {
    const exec = makeExec('bash', 150)
    const t0 = Date.now()
    await expect(exec(['-c', 'trap "" TERM; sleep 2'])).rejects.toThrow(/timed out after 150ms/)
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

describe('execFailureReason', () => {
  it('returns null when stdout is present and exit code is 1 (max-turns boundary case)', () => {
    const outcome = { stdout: '{"event":"message","content":"hello"}', exitCode: 1, stderr: '' }
    expect(execFailureReason(outcome)).toBeNull()
  })

  it('returns null when stdout is present and exit code is 0', () => {
    const outcome = { stdout: '{"event":"message","content":"hello"}', exitCode: 0, stderr: '' }
    expect(execFailureReason(outcome)).toBeNull()
  })

  it('returns non-null when stdout is empty and exit code is non-zero', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('exit 1')
  })

  it('includes stderr text in the failure message when present', () => {
    const outcome = { stdout: '', exitCode: 127, stderr: 'command not found: claude' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('command not found: claude')
  })

  it('returns non-null message for empty stdout with no stderr', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toBeTruthy()
  })

  it('handles signal termination (null exit code) with empty stdout', () => {
    const outcome = { stdout: '', exitCode: null, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('signal')
  })

  it('treats whitespace-only stdout as empty', () => {
    const outcome = { stdout: '   \n\t  ', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('exit 1')
  })
})

// 헤드리스 -p 는 세션의 도구 레지스트리를 그대로 상속한다. 실측(2026-07-29)에서 기본 상태의
// 도구가 149개였고 그중 116개가 연결된 MCP 서버였다 — 평가 실행이 회사 Slack MCP 를 호출한
// 사례가 실제로 보고됐다. 평가는 무인으로 수십 번 반복되므로 되돌릴 수 없는 도구를 열어둘 수 없다.
describe('buildArgs · 부수효과 도구 차단', () => {
  const saved = process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS
  afterEach(() => {
    if (saved === undefined) delete process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS
    else process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = saved
  })

  const variants = ['with', 'forced', 'without'] as const

  it('cuts MCP servers off on every variant', () => {
    for (const v of variants) {
      expect(buildArgs(v, skill, 'x'), v).toContain('--strict-mcp-config')
    }
  })

  it('denies tools whose effects outlive the run, on every variant', () => {
    for (const v of variants) {
      const args = buildArgs(v, skill, 'x')
      for (const tool of ['CronCreate', 'RemoteTrigger', 'PushNotification', 'SendMessage', 'Task', 'Workflow']) {
        expect(args, `${v}/${tool}`).toContain(tool)
      }
    }
  })

  // 스킬이 일할 능력까지 뺏으면 측정 자체가 왜곡된다 — 도구를 못 써서 진 것을 품질로 읽게 된다.
  // 허용 목록에 같은 이름이 나올 수 있으므로 차단 목록 구간만 본다.
  const deniedOf = (args: string[]): string[] => {
    const rest = args.slice(args.indexOf('--disallowedTools') + 1)
    const end = rest.findIndex(a => a.startsWith('--'))
    return end === -1 ? rest : rest.slice(0, end)
  }

  it('leaves the skill able to do its work', () => {
    const denied = deniedOf(buildArgs('forced', skill, 'x'))
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'Skill', 'WebSearch']) {
      expect(denied, tool).not.toContain(tool)
    }
  })

  // 헤드리스 기본 권한은 git 등 임의 Bash 와 파일 쓰기를 승인 대기로 즉시 거부한다 — 실측
  // (2026-07-31 스모크): forced 가 git --version 거부에 막혀 멈췄다. 격리 전에는 계정의
  // Bash(*) 허용이 이걸 가리고 있었다. 품질 변형에만 작업 도구를 명시 허용한다 — 부작용
  // 도구 차단과 MCP 차단은 거부가 허용에 우선하므로 그대로다.
  it('grants working tools to the quality variants — headless defaults deny git and writes', () => {
    for (const v of ['forced', 'without'] as const) {
      const args = buildArgs(v, skill, 'x')
      expect(args, v).toContain('--allowedTools')
      expect(args, v).toContain('Bash(*)')
      expect(args, v).toContain('Write')
    }
  })

  it('keeps the trigger variant on default permissions — extra grants could shift trigger behavior', () => {
    expect(buildArgs('with', skill, 'x')).not.toContain('--allowedTools')
  })

  it('still denies side-effect tools alongside the quality grants', () => {
    const denied = deniedOf(buildArgs('forced', skill, 'x'))
    expect(denied).toContain('CronCreate')
    expect(denied).toContain('Workflow')
  })

  // --disallowedTools 는 가변인자다. 두 번 넘기면 뒤엣것이 앞엣것을 덮거나 파싱이 어긋난다.
  it('passes exactly one --disallowedTools even when the baseline adds its own', () => {
    const args = buildArgs('without', skill, 'x', { degradedBaseline: true })
    expect(args.filter(a => a === '--disallowedTools')).toHaveLength(1)
    expect(args).toContain('Grep')
    expect(args).toContain('CronCreate')
  })

  it('still blocks the baseline\'s own tools alongside the guard', () => {
    const args = buildArgs('without', skill, 'x')
    expect(args).toContain('Skill')
    expect(args).toContain(`Read(${skill.dir}/**)`)
    expect(args).toContain('--strict-mcp-config')
  })

  // MCP 를 감싸는 스킬은 도구를 뺏으면 측정이 성립하지 않는다 — 명시적 탈출구를 둔다.
  it('lifts the guard when the operator opts in explicitly', () => {
    process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = '1'
    const args = buildArgs('forced', skill, 'x')
    expect(args).not.toContain('--strict-mcp-config')
    expect(args).not.toContain('CronCreate')
  })

  it('still blocks the baseline\'s own tools when the guard is lifted', () => {
    process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = '1'
    const args = buildArgs('without', skill, 'x', { degradedBaseline: true })
    expect(args).toContain('--disallowedTools')
    expect(args).toContain('Grep')
    expect(args).not.toContain('CronCreate')
  })

  it('does not treat any other value as opt-in', () => {
    process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = 'true'
    expect(buildArgs('forced', skill, 'x')).toContain('--strict-mcp-config')
  })
})

// 실측(2026-07-29, claude-code 2.1.220): 기본 헤드리스 세션에는 계정 전역 플러그인의 스킬
// 66개(superpowers 14개 포함)와 유저 CLAUDE.md·rules 가 로드된다. msuarcade:init 평가에서
// 트리거 실패 10건 중 9건이 superpowers 브레인스토밍 훅에 첫 턴을 뺏겼다 — description 이
// 아니라 환경이 결과를 정했다. --setting-sources project 는 유저 스코프를 제외해 이를 전부
// 끊고(66→23 스킬 실측, OAuth 유지), --plugin-dir 는 측정 대상 플러그인만 명시 로드한다.
describe('격리 · isolationLevel/buildArgs', () => {
  const rooted = { ...skill, pluginRoot: '/tmp/plugins/demo' }
  const saved = process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS
  afterEach(() => {
    if (saved === undefined) delete process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS
    else process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = saved
  })

  // 부수효과 모드에서 cwd 격리까지 꺼지면 런들이 폴더를 공유해 앞 런의 산출물이 뒷 런의
  // 전제를 깬다 (실측 2026-07-30, init 의 1단계 가드 충돌). 도구 개방과 cwd 격리는 별개다.
  it('grades a plugin skill as full, a rootless skill as cwd-only, side-effects mode as cwd', () => {
    expect(isolationLevel(rooted)).toBe('full')
    expect(isolationLevel(skill)).toBe('cwd')
    process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = '1'
    expect(isolationLevel(rooted)).toBe('cwd')
  })

  it('loads only the measured plugin and drops the user scope on with and forced', () => {
    for (const v of ['with', 'forced'] as const) {
      const args = buildArgs(v, rooted, 'x')
      expect(args, v).toEqual(expect.arrayContaining(['--setting-sources', 'project']))
      expect(args, v).toEqual(expect.arrayContaining(['--plugin-dir', '/tmp/plugins/demo']))
    }
  })

  // 대조군은 스킬의 어떤 흔적도 몰라야 한다. --plugin-dir 는 훅·스킬 목록까지 싣는다 —
  // 실측(2026-07-30, superpowers)에서 baseline 이 훅으로 브레인스토밍 교리를 주입받은 채
  // 답해 페어와이즈 델타가 구조적으로 0에 눌렸다.
  it('keeps the baseline plugin-free — user scope dropped but no plugin loaded', () => {
    const args = buildArgs('without', rooted, 'x')
    expect(args).toEqual(expect.arrayContaining(['--setting-sources', 'project']))
    expect(args).not.toContain('--plugin-dir')
    expect(args).not.toContain('--add-dir')
  })

  // 실험군은 스킬이 실제로 일해야 한다 — 참조 파일·애셋이 플러그인 디렉터리에 있다.
  // 실측(2026-07-30): --add-dir 는 Read·Bash 접근을 함께 열고 그 디렉터리의 CLAUDE.md 는
  // 주입하지 않는다. 설정 심기(additionalDirectories)는 미신뢰 워크스페이스라 무시된다.
  it('opens the plugin directory to the forced variant only', () => {
    expect(buildArgs('forced', rooted, 'x')).toEqual(expect.arrayContaining(['--add-dir', '/tmp/plugins/demo']))
    expect(buildArgs('with', rooted, 'x')).not.toContain('--add-dir')
  })

  it('opens the skill directory itself for a forced personal skill', () => {
    expect(buildArgs('forced', skill, 'x')).toEqual(expect.arrayContaining(['--add-dir', skill.dir]))
  })

  // 개인 스킬은 유저 스코프에 산다 — 스코프를 제외하면 측정 대상 자체가 안 실린다.
  it('keeps the user scope for a skill without a plugin root', () => {
    const args = buildArgs('with', skill, 'x')
    expect(args).not.toContain('--setting-sources')
    expect(args).not.toContain('--plugin-dir')
  })

  it('drops isolation args entirely in side-effects mode — that mode measures the real environment', () => {
    process.env.SKILL_EVAL_ALLOW_SIDE_EFFECTS = '1'
    for (const v of ['with', 'forced', 'without'] as const) {
      const args = buildArgs(v, rooted, 'x', { skillMd: '# 스킬' })
      expect(args, v).not.toContain('--setting-sources')
      expect(args, v).not.toContain('--plugin-dir')
      expect(args, v).not.toContain('--add-dir')
    }
  })

  // 심판·증강 호출의 컨텍스트에 유저 CLAUDE.md·rules 가 주입되면 판정이 계정 지시문에 흔들린다.
  it('excludes the user scope from text-only calls too', () => {
    expect(buildTextOnlyArgs('x')).toEqual(expect.arrayContaining(['--setting-sources', 'project']))
  })
})

// 실측(2026-07-30, CLI 2.1.220): -p 모드의 슬래시 커맨드는 "로드했다"는 메시지만 남기고
// SKILL.md 본문을 컨텍스트에 넣지 않는다. 격리 전에는 계정의 Bash(*) 허용이 모델의 자가-읽기
// 폴백을 몰래 지탱해 티가 안 났고, 격리가 그 목발을 치우자 실험군이 전멸했다. 본문을 하네스가
// 직접 프롬프트에 넣으면 "본문이 컨텍스트에 있다"가 구성상 보장되고, Skill tool_use 블록
// 유무로 발동을 재는 비결정적 검사(같은 명령이 블록 없이 체크리스트만 따르는 사례 실측)도
// 통째로 불필요해진다.
describe('forced 본문 주입', () => {
  const md = '---\nname: write\n---\n\n# 절차\n1단계: 대상 폴더를 확인한다.'

  it('embeds the skill body and the request in the forced prompt instead of a slash command', () => {
    const args = buildArgs('forced', skill, 'MR 써줘', { skillMd: md })
    const p = args[args.indexOf('-p') + 1]
    expect(p).toContain('1단계: 대상 폴더를 확인한다.')
    expect(p).toContain('MR 써줘')
    expect(p).toContain(skill.dir)
    expect(p.startsWith('/')).toBe(false)
  })

  it('names the skill id so the transcript stays attributable', () => {
    const p = buildForcedPrompt(skill, md, 'x')
    expect(p).toContain('demo:write')
  })

  it('falls back to the slash command when no body is supplied', () => {
    const args = buildArgs('forced', skill, 'MR 써줘')
    const p = args[args.indexOf('-p') + 1]
    expect(p).toBe('/demo:write MR 써줘')
  })
})

describe('makeExec · cwd', () => {
  it('runs the child in the requested cwd', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'exec-cwd-'))
    try {
      const exec = makeExec('sh', 5000)
      const r = await exec(['-c', 'pwd'], { cwd: ws })
      expect(r.stdout.trim()).toBe(realpathSync(ws))
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  it('inherits the parent cwd when no cwd is given', async () => {
    const exec = makeExec('sh', 5000)
    const r = await exec(['-c', 'pwd'])
    expect(r.stdout.trim()).toBe(realpathSync(process.cwd()))
  })
})
