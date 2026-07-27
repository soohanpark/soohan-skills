import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCodexArgs } from '../../plugins/skill-eval/skills/score/scripts/runtimes/codex'
import { parseCodexStream } from '../../plugins/skill-eval/skills/score/scripts/parse'
import { execFailureReason } from '../../plugins/skill-eval/skills/score/scripts/runtimes/claude'

// dir 은 paths.ts#resolveSkill 규약대로 SKILL.md 를 담은 디렉터리(내부 스킬명으로 끝남).
const skill = { id: 'blin-mr:write', dir: '/tmp/plugins/blin-mr/skills/write' }
const opts = { skillId: skill.id, skillDir: skill.dir }
const fixture = readFileSync(join(__dirname, '..', 'fixtures', 'codex-triggered.jsonl'), 'utf8')

describe('buildCodexArgs', () => {
  it('runs exec with JSONL output', () => {
    const args = buildCodexArgs('with', skill, 'MR 써줘')
    expect(args[0]).toBe('exec')
    expect(args).toContain('--json')
    expect(args).toContain('MR 써줘')
  })

  it('skips the git repo check so eval can run anywhere', () => {
    expect(buildCodexArgs('with', skill, 'x')).toContain('--skip-git-repo-check')
  })

  it('does not persist session files', () => {
    expect(buildCodexArgs('with', skill, 'x')).toContain('--ephemeral')
  })

  it('builds the forced variant naming the skill directly — Codex has no slash-command equivalent', () => {
    const args = buildCodexArgs('forced', skill, 'MR 써줘')
    expect(args.join(' ')).toContain(skill.id)
    expect(args.join(' ')).toContain('MR 써줘')
  })

  it('throws for the without-variant — CODEX_HOME breaks auth (verified live, Step 6)', () => {
    expect(() => buildCodexArgs('without', skill, 'x')).toThrow(/CODEX_HOME|auth/i)
  })
})

describe('parseCodexStream', () => {
  it('detects a skill invocation', () => {
    const r = parseCodexStream(fixture, opts)
    expect(r.triggered).toBe(true)
  })

  it('collects the final message text', () => {
    const r = parseCodexStream(fixture, opts)
    expect(r.finalText).toContain('작성했습니다')
  })

  it('returns status ok and sums usage input/output tokens when the stream completes', () => {
    const r = parseCodexStream(fixture, opts)
    expect(r.status).toBe('ok')
    expect(r.tokens).toBe(1150)
  })

  it('returns status error when the stream has no completion event', () => {
    const r = parseCodexStream('{"type":"thread.started","thread_id":"x"}', { skillId: 'x', skillDir: 'y' })
    expect(r.status).toBe('error')
    expect(r.terminalReason).toBe('no_completion_event')
  })

  it('ignores a command reading an unrelated file', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat README.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(false)
  })

  it('ignores a different skill directory that happens to also end in SKILL.md', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat plugins/other/skills/thing/SKILL.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(false)
  })

  it('treats informational error items as non-fatal noise, not a failed run', () => {
    const raw = '{"type":"item.completed","item":{"type":"error","message":"Skill descriptions were shortened to fit the budget."}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.status).toBe('ok')
  })

  it('ignores non-JSON lines such as the stdin banner', () => {
    const raw = 'Reading additional input from stdin...\n' + fixture
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(true)
  })

  it('does not report cost or model — Codex emits neither field (verified live)', () => {
    const r = parseCodexStream(fixture, opts)
    expect(r.costUsd).toBe(0)
    expect(r.model).toBe('')
  })

  it('does not false-positive on a directory whose name merely ends with the inner skill name', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat plugins/other/skills/rewrite/SKILL.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(false)
  })

  it('does not false-positive on a directory whose name merely ends with the plugin name', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat ~/.codex/skills/not-blin-mr/SKILL.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(false)
  })

  it('detects the install.sh multi-skill naming <plugin>-<skill>', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat ~/.codex/skills/blin-mr-write/SKILL.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(true)
  })

  it('also detects the invocation via the ~/.codex/skills/<plugin> symlink-style path', () => {
    const raw = '{"type":"item.completed","item":{"type":"command_execution","command":"cat ~/.codex/skills/blin-mr/SKILL.md"}}\n' +
                '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
    const r = parseCodexStream(raw, opts)
    expect(r.triggered).toBe(true)
  })

  it('defaults tokens to 0 when turn.completed carries no usage object', () => {
    const r = parseCodexStream('{"type":"turn.completed"}', opts)
    expect(r.status).toBe('ok')
    expect(r.tokens).toBe(0)
  })
})

// execCodex를 execClaude와 같은 에러 계약(execFailureReason)으로 강화한다 — 단, 메시지가
// 실제로 실패한 CLI 이름(codex)을 가리켜야 한다. claude 하드코딩 메시지를 그대로 재사용하면
// codex 크래시 로그에 "claude produced no output"이 찍혀 오도된다 (Task 12 강화).
describe('execFailureReason reused for codex', () => {
  it('names codex instead of claude in the failure message when given a cli override', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome, 'codex')
    expect(reason).toContain('codex')
    expect(reason).not.toContain('claude')
  })

  it('still defaults to claude when no cli override is given — existing callers unaffected', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    expect(execFailureReason(outcome)).toContain('claude')
  })

  it('returns null for codex too when stdout is non-empty, regardless of a nonzero exit code', () => {
    const outcome = { stdout: '{"type":"turn.completed"}', exitCode: 1, stderr: '' }
    expect(execFailureReason(outcome, 'codex')).toBeNull()
  })
})
