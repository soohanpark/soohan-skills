import { describe, it, expect } from 'vitest'
import { checkRules } from '../../plugins/skill-eval/skills/score/scripts/rules'

describe('checkRules', () => {
  it('passes when every must substring is present', () => {
    const r = checkRules('## 변경 사항\n내용', { must: ['## 변경 사항'] })
    expect(r.passed).toBe(true)
    expect(r.failures).toEqual([])
  })

  it('fails and names the missing must', () => {
    const r = checkRules('아무 내용', { must: ['## 변경 사항'] })
    expect(r.passed).toBe(false)
    expect(r.failures).toEqual(['must 누락: "## 변경 사항"'])
  })

  it('fails when a must_not substring appears', () => {
    const r = checkRules('```diff\n+a', { must_not: ['```diff'] })
    expect(r.passed).toBe(false)
    expect(r.failures[0]).toMatch(/must_not 위반/)
  })

  it('treats a /pattern/ value as a regular expression', () => {
    const r = checkRules('버전 1.2.3 릴리스', { must: ['/버전 \\d+\\.\\d+\\.\\d+/'] })
    expect(r.passed).toBe(true)
  })

  it('fails a regex must that does not match', () => {
    const r = checkRules('버전 없음', { must: ['/버전 \\d+/'] })
    expect(r.passed).toBe(false)
  })

  it('supports regex flags in /pattern/flags form', () => {
    const r = checkRules('HELLO', { must: ['/hello/i'] })
    expect(r.passed).toBe(true)
  })

  it('passes when no rules are declared', () => {
    expect(checkRules('anything', {}).passed).toBe(true)
  })

  it('reports every violation rather than stopping at the first', () => {
    const r = checkRules('x', { must: ['a', 'b'], must_not: ['x'] })
    expect(r.failures).toHaveLength(3)
  })
})
