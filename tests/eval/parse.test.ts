import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClaudeStream, parseCodexStream } from '../../plugins/skill-eval/skills/score/scripts/parse'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', `${name}.jsonl`), 'utf8')

const opts = { skillId: 'demo:write', skillDir: '/tmp/plugins/demo/skills/write' }

describe('parseClaudeStream', () => {
  it('detects a triggered skill', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.triggered).toBe(true)
    expect(r.skillReadFallback).toBe(false)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('completed')
  })

  it('collects final text, cost, tokens and model', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.finalText).toBe('작성했습니다.')
    expect(r.costUsd).toBeCloseTo(0.1234)
    // 1200 in + 300 out + 2000 cache_creation + 5000 cache_read
    expect(r.tokens).toBe(8500)
    expect(r.model).toBe('claude-opus-4-8[1m]')
  })

  it('counts cache tokens — they dwarf input+output and are most of real usage', () => {
    const raw = '{"type":"system","subtype":"init","model":"m","skills":[]}\n' +
                '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","result":"ok",' +
                '"usage":{"input_tokens":10,"output_tokens":134,"cache_creation_input_tokens":14540,"cache_read_input_tokens":17536},' +
                '"total_cost_usd":0.0315}\n'
    expect(parseClaudeStream(raw, opts).tokens).toBe(32220)
  })

  it('treats a completed run as ok — the value the CLI actually emits', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.status).toBe('ok')
    expect(r.truncated).toBe(false)
  })

  it('classifies by is_error, not by subtype — an api_error reports subtype "success"', () => {
    const r = parseClaudeStream(fixture('claude-auth-error'), opts)
    expect(r.status).toBe('error')
  })

  it('falls back to the terminal_reason list when the CLI omits is_error', () => {
    const r = parseClaudeStream(fixture('claude-legacy-no-is-error'), opts)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('completed')
  })

  it('treats an unknown terminal_reason without is_error as an error', () => {
    const raw = '{"type":"system","subtype":"init","model":"m","skills":[]}\n' +
                '{"type":"result","terminal_reason":"something_new","result":"","usage":{}}\n'
    expect(parseClaudeStream(raw, opts).status).toBe('error')
  })

  it('records the competing skill list from the init event', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.loadedSkills).toEqual(['demo:write', 'other:thing'])
  })

  it('flags a Read of the skill directory as a fallback, not a trigger', () => {
    const r = parseClaudeStream(fixture('claude-read-fallback'), opts)
    expect(r.triggered).toBe(false)
    expect(r.skillReadFallback).toBe(true)
  })

  it('marks an auth failure as error, not as a non-trigger', () => {
    const r = parseClaudeStream(fixture('claude-auth-error'), opts)
    expect(r.status).toBe('error')
    expect(r.terminalReason).toBe('api_error')
    expect(r.triggered).toBe(false)
  })

  it('treats max_turns as ok — the trigger axis cuts at turn 1 on purpose', () => {
    const r = parseClaudeStream(fixture('claude-max-turns'), opts)
    expect(r.status).toBe('ok')
    expect(r.triggered).toBe(true)
  })

  it('flags max_turns as truncated so the quality axis can skip a cut-off answer', () => {
    expect(parseClaudeStream(fixture('claude-max-turns'), opts).truncated).toBe(true)
    expect(parseClaudeStream(fixture('claude-triggered'), opts).truncated).toBe(false)
  })

  it('ignores a Skill call for a different skill', () => {
    const raw = fixture('claude-triggered')
    const r = parseClaudeStream(raw, { ...opts, skillId: 'someone:else' })
    expect(r.triggered).toBe(false)
  })

  it('ignores non-JSON lines such as CLI warnings', () => {
    const raw = 'Warning: no stdin data received in 3s\n' + fixture('claude-triggered')
    const r = parseClaudeStream(raw, opts)
    expect(r.triggered).toBe(true)
  })

  it('returns status error when no result event is present', () => {
    const raw = fixture('claude-triggered').split('\n').filter(l => !l.includes('"type":"result"')).join('\n')
    const r = parseClaudeStream(raw, opts)
    expect(r.status).toBe('error')
    expect(r.terminalReason).toBe('no_result_event')
  })

  it('does not flag a Read of a sibling directory sharing the prefix', () => {
    const raw = '{"type":"system","subtype":"init","model":"test","skills":[]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/plugins/demo/skills/write-v2/SKILL.md"}}]}}\n' +
                '{"type":"result","is_error":false,"terminal_reason":"completed","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(false)
  })

  it('does not flag a Read of an unrelated path as fallback', () => {
    const raw = '{"type":"system","subtype":"init","model":"test","skills":[]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/other/path/file.txt"}}]}}\n' +
                '{"type":"result","is_error":false,"terminal_reason":"completed","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(false)
  })

  it('flags a Read of a file inside the skill directory', () => {
    const raw = '{"type":"system","subtype":"init","model":"test","skills":[]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/plugins/demo/skills/write/SKILL.md"}}]}}\n' +
                '{"type":"result","is_error":false,"terminal_reason":"completed","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(true)
  })

  it('ignores truncated JSON lines that start with { but are malformed', () => {
    const raw = '{"type":"system","subtype":"init","model":"claude-opus-4-8[1m]","skills":["demo:write","other:thing"]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"text","text":"작성했습니다."}]}}\n' +
                '{"type":"result", broken\n' +
                '{"type":"result","is_error":false,"terminal_reason":"completed","result":"작성했습니다.","usage":{"input_tokens":800,"output_tokens":700},"total_cost_usd":0.1234}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('completed')
    expect(r.finalText).toBe('작성했습니다.')
  })
})

// baseline(without)은 Skill·Read 를 차단당하면 셸로 우회한다. 실측에서 `cat …/SKILL.md` 로 읽고도
// 오염 플래그가 false 로 남아 대조군이 오염된 채 품질 델타가 계산됐다 (2026-07-28).
// 트리거 축이 정찰 1턴을 허용하면서(--max-turns 2), "즉시 발동"과 "정찰 후 발동"을 구분할
// 신호가 필요하다 — 실측(2026-07-30, msuarcade:init)에서 발동 여부를 가른 변수는 프롬프트의
// 의미가 아니라 모델이 정찰을 했는지였다. 첫 대상 Skill 호출 이전의 tool_use 수를 센다.
describe('parseClaudeStream · 정찰 지표 (reconToolCalls)', () => {
  const init = '{"type":"system","subtype":"init","model":"m","skills":[]}'
  const done = '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","result":"ok","usage":{}}'
  const ev = (blocks: unknown[]) => JSON.stringify({ type: 'assistant', message: { content: blocks } })
  const use = (name: string, input: object) => ({ type: 'tool_use', name, input })
  const stream = (...lines: string[]) => [init, ...lines, done].join('\n')

  it('reports 0 recon calls when the target skill fires first', () => {
    const r = parseClaudeStream(stream(ev([use('Skill', { skill: 'demo:write' })])), opts)
    expect(r.triggered).toBe(true)
    expect(r.reconToolCalls).toBe(0)
  })

  it('counts tool calls made before the first target-skill call', () => {
    const raw = stream(
      ev([use('Bash', { command: 'ls -la' })]),
      ev([use('Skill', { skill: 'demo:write' })])
    )
    expect(parseClaudeStream(raw, opts).reconToolCalls).toBe(1)
  })

  // 형제 스킬을 먼저 골랐다가 대상으로 온 사례(실측: writing-skills → brainstorming)도 정찰이다.
  it('counts a sibling-skill call as recon too', () => {
    const raw = stream(ev([use('Skill', { skill: 'demo:other' }), use('Skill', { skill: 'demo:write' })]))
    expect(parseClaudeStream(raw, opts).reconToolCalls).toBe(1)
  })

  it('reports null when the skill never fires', () => {
    const r = parseClaudeStream(stream(ev([use('Bash', { command: 'ls' })])), opts)
    expect(r.triggered).toBe(false)
    expect(r.reconToolCalls).toBeNull()
  })

  it('keeps the count of the first firing when the skill is called again later', () => {
    const raw = stream(
      ev([use('Skill', { skill: 'demo:write' })]),
      ev([use('Bash', { command: 'ls' }), use('Skill', { skill: 'demo:write' })])
    )
    expect(parseClaudeStream(raw, opts).reconToolCalls).toBe(0)
  })

  // codex 스트림에는 대응하는 신호 계약이 없다 — 없는 것을 있는 것처럼 세지 않는다.
  it('stays null on the codex parser', () => {
    const r = parseCodexStream('{"type":"turn.completed","usage":{}}', opts)
    expect(r.reconToolCalls).toBeNull()
  })
})

describe('parseClaudeStream · baseline 오염 탐지', () => {
  const withEvents = (...events: string[]) =>
    '{"type":"system","subtype":"init","model":"m","skills":[]}\n' +
    events.map(e => `{"type":"assistant","message":{"content":[${e}]}}`).join('\n') + '\n' +
    '{"type":"result","is_error":false,"terminal_reason":"completed","result":"ok","usage":{},"total_cost_usd":0}\n'

  const toolUse = (name: string, input: Record<string, unknown>) =>
    JSON.stringify({ type: 'tool_use', name, input })

  it('flags a Bash cat of the installed SKILL.md even though the path is not the measured dir', () => {
    const r = parseClaudeStream(fixture('claude-bash-read-fallback'), opts)
    expect(r.skillReadFallback).toBe(true)
  })

  it('flags a Bash read that reaches the skill by the install.sh <plugin> directory name', () => {
    const raw = withEvents(toolUse('Bash', { command: 'sed -n 1,40p ~/.codex/skills/demo/SKILL.md' }))
    expect(parseClaudeStream(raw, opts).skillReadFallback).toBe(true)
  })

  it('flags a Bash read using the install.sh <plugin>-<skill> directory name', () => {
    const raw = withEvents(toolUse('Bash', { command: 'cat ~/.gemini/skills/demo-write/SKILL.md' }))
    expect(parseClaudeStream(raw, opts).skillReadFallback).toBe(true)
  })

  it('flags Grep and Glob that reach into the skill directory', () => {
    expect(parseClaudeStream(withEvents(toolUse('Grep', { pattern: 'MR', path: '/tmp/plugins/demo/skills/write' })), opts).skillReadFallback).toBe(true)
    expect(parseClaudeStream(withEvents(toolUse('Glob', { pattern: 'demo/skills/write/SKILL.md' })), opts).skillReadFallback).toBe(true)
  })

  it('does not flag a Bash command that merely mentions an unrelated SKILL.md', () => {
    const raw = withEvents(toolUse('Bash', { command: 'cat ~/.claude/skills/other-thing/SKILL.md' }))
    expect(parseClaudeStream(raw, opts).skillReadFallback).toBe(false)
  })

  it('does not flag a sibling skill whose name shares the prefix', () => {
    const raw = withEvents(toolUse('Bash', { command: 'cat /x/write-v2/SKILL.md' }))
    expect(parseClaudeStream(raw, opts).skillReadFallback).toBe(false)
  })

  // judge/mine 은 발동 판정이 필요 없어 skillId·skillDir 를 빈 문자열로 넘긴다. 후보 이름이 하나도
  // 없으면 정규식이 빈 교대로 퇴화해 모든 SKILL.md 언급에 매치한다 — 반드시 끊어야 한다.
  it('never flags anything when no skill is identified (judge/mine pass empty ids)', () => {
    const empty = { skillId: '', skillDir: '' }
    const raw = withEvents(toolUse('Bash', { command: 'cat /anything/at/all/SKILL.md' }))
    expect(parseClaudeStream(raw, empty).skillReadFallback).toBe(false)
    const readRaw = withEvents(toolUse('Read', { file_path: '/etc/hosts' }))
    expect(parseClaudeStream(readRaw, empty).skillReadFallback).toBe(false)
  })
})

// 이 레포 규약은 내부 스킬명을 run·write·diff 처럼 짧게 쓴다. 그 이름을 단독으로 매칭하면
// 남의 플러그인 SKILL.md 를 읽은 것까지 오염으로 세어, 멀쩡한 비교쌍이 조용히 폐기된다.
describe('skillReadPattern · 짧은 내부 스킬명', () => {
  const raw = (command: string) =>
    '{"type":"system","subtype":"init","model":"m","skills":[]}\n' +
    `{"type":"assistant","message":{"content":[${JSON.stringify({ type: 'tool_use', name: 'Bash', input: { command } })}]}}\n` +
    '{"type":"result","is_error":false,"terminal_reason":"completed","result":"ok","usage":{},"total_cost_usd":0}\n'
  const o = { skillId: 'demo:run', skillDir: '/repo/plugins/demo/skills/run' }

  it('does not treat another plugin\'s same-named skill as contamination', () => {
    expect(parseClaudeStream(raw('cat /x/otherplugin/skills/run/SKILL.md'), o).skillReadFallback).toBe(false)
  })

  it('still catches the measured skill in a commit-SHA cache layout', () => {
    expect(parseClaudeStream(raw('cat ~/.claude/plugins/cache/mk/demo/fc030ea1/skills/run/SKILL.md'), o).skillReadFallback).toBe(true)
  })

  it('still catches the measured skill at its repo path', () => {
    expect(parseClaudeStream(raw('sed -n 1,20p /repo/plugins/demo/skills/run/SKILL.md'), o).skillReadFallback).toBe(true)
  })

  it('catches the installed <plugin> directory name', () => {
    expect(parseClaudeStream(raw('cat ~/.codex/skills/demo/SKILL.md'), o).skillReadFallback).toBe(true)
  })

  // 경로를 변수나 cd 로 감싸면 이름 패턴이 안 걸린다 — 측정 대상 절대경로가 커맨드에 있으면 잡는다.
  it('catches a shell command that merely mentions the measured directory', () => {
    expect(parseClaudeStream(raw('cd /repo/plugins/demo/skills/run && cat SKILL.md'), o).skillReadFallback).toBe(true)
  })
})

// 헤드리스 실행은 권한이 필요한 도구를 사람에게 묻지 않고 즉시 거부한다 (실측 2026-07-29:
// Write 호출이 13초 만에 거부되고 실행은 is_error:false / terminal_reason completed 로 끝났다).
// 거부는 result 이벤트에만 남고 종료 상태에는 안 나타나므로, 아무도 안 읽으면 "스킬이 제 일을
// 못 한 실행" 이 정상 측정으로 계상된다 — finalText 가 "권한을 주세요" 인 채로.
describe('parseClaudeStream · 권한 거부', () => {
  const withDenials = (denials: unknown) =>
    '{"type":"system","subtype":"init","model":"m","skills":[]}\n' +
    '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed",' +
    `"permission_denials":${JSON.stringify(denials)},` +
    '"result":"I need your permission to write the file.","usage":{},"total_cost_usd":0.01}\n'

  it('records which tools were denied', () => {
    const r = parseClaudeStream(withDenials([
      { tool_name: 'Write', tool_use_id: 't1', tool_input: {} },
      { tool_name: 'Bash', tool_use_id: 't2', tool_input: {} }
    ]), opts)
    expect(r.permissionDenials).toEqual(['Write', 'Bash'])
  })

  it('still reports the run as ok — the CLI itself does not treat a denial as an error', () => {
    const r = parseClaudeStream(withDenials([{ tool_name: 'Write' }]), opts)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('completed')
  })

  it('is empty when nothing was denied', () => {
    expect(parseClaudeStream(fixture('claude-triggered'), opts).permissionDenials).toEqual([])
  })

  it('survives a malformed denials field', () => {
    expect(parseClaudeStream(withDenials('nope'), opts).permissionDenials).toEqual([])
    expect(parseClaudeStream(withDenials([{}]), opts).permissionDenials).toEqual(['unknown'])
  })
})
