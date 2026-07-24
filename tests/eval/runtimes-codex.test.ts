import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCodexArgs } from '../../scripts/eval/runtimes/codex'
import { parseCodexStream } from '../../scripts/eval/parse'

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
