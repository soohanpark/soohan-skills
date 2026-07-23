import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCases } from '../../scripts/eval/cases'

let root: string
const write = (lines: string[]) => {
  const p = join(root, 'cases.jsonl')
  writeFileSync(p, lines.join('\n'))
  return p
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-cases-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('loadCases', () => {
  it('parses a minimal case and defaults split to train', () => {
    const p = write(['{"id":"t-001","prompt":"MR 써줘","expect":"trigger"}'])
    const cases = loadCases(p)
    expect(cases).toHaveLength(1)
    expect(cases[0].id).toBe('t-001')
    expect(cases[0].split).toBe('train')
  })

  it('keeps optional fields when present', () => {
    const p = write([JSON.stringify({
      id: 'q-001', prompt: 'x', expect: 'trigger', split: 'test',
      source: 'log:2026-07-14', must: ['## 변경 사항'], must_not: ['```diff'],
      qualitative: true, criteria: '템플릿을 채웠는가'
    })])
    const c = loadCases(p)[0]
    expect(c.split).toBe('test')
    expect(c.must).toEqual(['## 변경 사항'])
    expect(c.qualitative).toBe(true)
    expect(c.criteria).toBe('템플릿을 채웠는가')
  })

  it('ignores blank lines', () => {
    const p = write([
      '{"id":"a","prompt":"x","expect":"trigger"}',
      '',
      '   ',
      '{"id":"b","prompt":"y","expect":"no-trigger"}'
    ])
    expect(loadCases(p)).toHaveLength(2)
  })

  it('throws with the line number on malformed JSON', () => {
    const p = write([
      '{"id":"a","prompt":"x","expect":"trigger"}',
      '{ not json'
    ])
    expect(() => loadCases(p)).toThrow(/line 2/)
  })

  it('throws with the line number and field on schema violation', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"maybe"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*expect/s)
  })

  it('throws on missing required field', () => {
    const p = write(['{"id":"a","expect":"trigger"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*prompt/s)
  })

  it('throws on duplicate ids', () => {
    const p = write([
      '{"id":"dup","prompt":"x","expect":"trigger"}',
      '{"id":"dup","prompt":"y","expect":"trigger"}'
    ])
    expect(() => loadCases(p)).toThrow(/duplicate case id "dup"/)
  })

  it('returns [] for an empty file', () => {
    const p = write([])
    expect(loadCases(p)).toEqual([])
  })
})
