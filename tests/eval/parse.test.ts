import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseClaudeStream } from '../../scripts/eval/parse'

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
})
