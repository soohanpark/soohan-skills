import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCases, hashCases, casesDrifted } from '../../plugins/skill-eval/skills/score/scripts/cases'

let root: string
const write = (lines: string[]) => {
  const p = join(root, 'cases.jsonl')
  writeFileSync(p, lines.join('\n'))
  return p
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-cases-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('loadCases', () => {
  it('parses a minimal case', () => {
    const p = write(['{"id":"t-001","prompt":"MR 써줘","expect":"trigger","split":"train"}'])
    const cases = loadCases(p)
    expect(cases).toHaveLength(1)
    expect(cases[0].id).toBe('t-001')
    expect(cases[0].split).toBe('train')
  })

  // split 이 빠지면 조용히 train 으로 들어가 test 분모가 0이 되고, 판정 게이트가 전부
  // total > 0 으로 방어돼 있어 '✓ 합격' 이 찍힌다. 손으로 케이스를 쓰는 사람이 split 을
  // 모르는 것만으로 이 상태가 됐다 (외부 실측 보고 2026-07-28).
  it('throws when split is missing instead of silently defaulting to train', () => {
    const p = write(['{"id":"t-001","prompt":"MR 써줘","expect":"trigger"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*split/s)
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
      '{"id":"a","prompt":"x","expect":"trigger","split":"train"}',
      '',
      '   ',
      '{"id":"b","prompt":"y","expect":"no-trigger","split":"test"}'
    ])
    expect(loadCases(p)).toHaveLength(2)
  })

  it('throws with the line number on malformed JSON', () => {
    const p = write([
      '{"id":"a","prompt":"x","expect":"trigger","split":"train"}',
      '{ not json'
    ])
    expect(() => loadCases(p)).toThrow(/line 2/)
  })

  it('throws with the line number and field on schema violation', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"maybe","split":"train"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*expect/s)
  })

  it('throws on missing required field', () => {
    const p = write(['{"id":"a","expect":"trigger","split":"train"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*prompt/s)
  })

  it('throws when must is not a string array', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"trigger","split":"train","must":"not-array"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*must/s)
  })

  it('throws when qualitative is not a boolean', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"trigger","split":"train","qualitative":"yes"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*qualitative/s)
  })

  it('throws when split is not train or test', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"trigger","split":"validation"}'])
    expect(() => loadCases(p)).toThrow(/line 1.*split/s)
  })

  it('drops unknown keys', () => {
    const p = write(['{"id":"a","prompt":"x","expect":"trigger","split":"train","extra":1}'])
    expect(loadCases(p)[0]).not.toHaveProperty('extra')
  })

  it('throws on duplicate ids', () => {
    const p = write([
      '{"id":"dup","prompt":"x","expect":"trigger","split":"train"}',
      '{"id":"dup","prompt":"y","expect":"trigger","split":"train"}'
    ])
    expect(() => loadCases(p)).toThrow(/duplicate case id "dup"/)
  })

  it('returns [] for an empty file', () => {
    const p = write([])
    expect(loadCases(p)).toEqual([])
  })
})

// 기록해 둔 런을 나중에 report/judge 로 다시 채점할 때, 그 사이에 케이스 파일이 바뀌었는지
// 알아낼 유일한 수단이다. 실측 보고자는 "기록 후 split 만 지우고 report 재실행"으로
// 조용한 합격을 재현했다 — 그 조작이 지문에 남아야 한다.
describe('hashCases', () => {
  const c = (over: Record<string, unknown> = {}) => ({
    id: 'a', prompt: 'x', expect: 'trigger' as const, split: 'test' as const, ...over
  })

  it('is stable for the same cases', () => {
    expect(hashCases([c()])).toBe(hashCases([c()]))
  })

  it('is tagged with a format version so readers know whether they can recompute it', () => {
    expect(hashCases([c()])).toMatch(/^v3:/)
  })

  it('changes when split changes — the exact edit that faked a pass', () => {
    expect(hashCases([c({ split: 'train' })])).not.toBe(hashCases([c({ split: 'test' })]))
  })

  it('changes when a prompt, an expectation, an id or the case count changes', () => {
    const base = hashCases([c()])
    expect(hashCases([c({ prompt: 'y' })])).not.toBe(base)
    expect(hashCases([c({ expect: 'no-trigger' })])).not.toBe(base)
    expect(hashCases([c({ id: 'b' })])).not.toBe(base)
    expect(hashCases([c(), c({ id: 'b' })])).not.toBe(base)
  })

  it('does not collide when field values are shuffled across boundaries', () => {
    expect(hashCases([c({ id: 'a', prompt: 'b|c' })])).not.toBe(hashCases([c({ id: 'a|b', prompt: 'c' })]))
  })
})

describe('casesDrifted', () => {
  it('reports drift when a current-format hash no longer matches the case file', () => {
    expect(casesDrifted('v3:aaaaaaaaaaaa', 'v3:bbbbbbbbbbbb')).toBe(true)
  })

  it('is quiet when the hash still matches', () => {
    expect(casesDrifted('v3:aaaaaaaaaaaa', 'v3:aaaaaaaaaaaa')).toBe(false)
  })

  // 접두사 없는 해시는 plan 기반이라 재계산할 수 없다. 거짓 경고를 내면 진짜 경고까지 무시하게 된다.
  // 재계산할 수 없는 옛 포맷으로는 같다고도 다르다고도 말할 수 없다. 거짓 경고를 내면 진짜 경고까지 무시하게 된다.
  it('stays quiet for an older-format hash it cannot recompute', () => {
    expect(casesDrifted('a1b2c3d4e5f6', 'v3:bbbbbbbbbbbb')).toBe(false)
    expect(casesDrifted('v2:aaaaaaaaaaaa', 'v3:bbbbbbbbbbbb')).toBe(false)
  })

  it('stays quiet when the run predates the field entirely', () => {
    expect(casesDrifted(undefined, 'v3:bbbbbbbbbbbb')).toBe(false)
  })
})

// 지문이 채점에 쓰이는 필드를 다 담지 않으면, 판정을 뒤집는 편집이 흔적 없이 지나간다.
describe('hashCases · 채점 규칙 변경도 지문에 남는다', () => {
  const c = (over: Record<string, unknown> = {}) => ({
    id: 'a', prompt: 'x', expect: 'trigger' as const, split: 'test' as const, ...over
  })

  it('changes when a must rule is added, edited or removed', () => {
    const none = hashCases([c()])
    const one = hashCases([c({ must: ['## 변경 사항'] })])
    const edited = hashCases([c({ must: ['## 변경'] })])
    expect(one).not.toBe(none)
    expect(edited).not.toBe(one)
  })

  it('changes when must_not, qualitative or criteria change', () => {
    const base = hashCases([c()])
    expect(hashCases([c({ must_not: ['```diff'] })])).not.toBe(base)
    expect(hashCases([c({ qualitative: true })])).not.toBe(base)
    expect(hashCases([c({ criteria: '템플릿을 채웠는가' })])).not.toBe(base)
  })

  it('does not confuse a must rule with a must_not rule of the same text', () => {
    expect(hashCases([c({ must: ['x'] })])).not.toBe(hashCases([c({ must_not: ['x'] })]))
  })

  it('treats an absent rule and an empty rule list as the same case', () => {
    expect(hashCases([c({ must: [] })])).toBe(hashCases([c()]))
  })
})
