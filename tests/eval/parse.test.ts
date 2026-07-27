import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClaudeStream } from '../../plugins/skill-eval/skills/score/scripts/parse'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', `${name}.jsonl`), 'utf8')

const opts = { skillId: 'demo:write', skillDir: '/tmp/plugins/demo/skills/write' }

describe('parseClaudeStream', () => {
  it('detects a triggered skill', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.triggered).toBe(true)
    expect(r.skillReadFallback).toBe(false)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('success')
  })

  it('collects final text, cost, tokens and model', () => {
    const r = parseClaudeStream(fixture('claude-triggered'), opts)
    expect(r.finalText).toBe('작성했습니다.')
    expect(r.costUsd).toBeCloseTo(0.1234)
    expect(r.tokens).toBe(1500)
    expect(r.model).toBe('claude-opus-4-8[1m]')
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
                '{"type":"result","terminal_reason":"success","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(false)
  })

  it('does not flag a Read of an unrelated path as fallback', () => {
    const raw = '{"type":"system","subtype":"init","model":"test","skills":[]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/other/path/file.txt"}}]}}\n' +
                '{"type":"result","terminal_reason":"success","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(false)
  })

  it('flags a Read of a file inside the skill directory', () => {
    const raw = '{"type":"system","subtype":"init","model":"test","skills":[]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/plugins/demo/skills/write/SKILL.md"}}]}}\n' +
                '{"type":"result","terminal_reason":"success","result":"ok","usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.skillReadFallback).toBe(true)
  })

  it('ignores truncated JSON lines that start with { but are malformed', () => {
    const raw = '{"type":"system","subtype":"init","model":"claude-opus-4-8[1m]","skills":["demo:write","other:thing"]}\n' +
                '{"type":"assistant","message":{"content":[{"type":"text","text":"작성했습니다."}]}}\n' +
                '{"type":"result", broken\n' +
                '{"type":"result","terminal_reason":"success","result":"작성했습니다.","usage":{"input_tokens":800,"output_tokens":700},"total_cost_usd":0.1234}\n'
    const r = parseClaudeStream(raw, opts)
    expect(r.status).toBe('ok')
    expect(r.terminalReason).toBe('success')
    expect(r.finalText).toBe('작성했습니다.')
  })
})
