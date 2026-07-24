import { describe, it, expect } from 'vitest'
import { resolveSkill, slug, runDirName } from '../../scripts/eval/paths'
import { formatRecordSummary, buildRecordPlan, isQualityCase } from '../../scripts/eval/commands/record'
import type { EvalCase } from '../../scripts/eval/cases'

describe('resolveSkill', () => {
  it('expands a plugin:skill id into the repository skill directory', () => {
    const r = resolveSkill('demo:write', '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.dir).toBe('/repo/plugins/demo/skills/write')
  })

  it('derives the id from a SKILL.md directory path', () => {
    const r = resolveSkill('/abs/plugins/demo/skills/write', '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.dir).toBe('/abs/plugins/demo/skills/write')
  })

  it('strips a trailing slash from a directory path', () => {
    expect(resolveSkill('/abs/plugins/demo/skills/write/', '/repo').dir)
      .toBe('/abs/plugins/demo/skills/write')
  })

  it('throws on an id without a colon', () => {
    expect(() => resolveSkill('demo', '/repo')).toThrow(/plugin:skill/)
  })
})

describe('slug', () => {
  it('turns a skill id into a directory-safe name', () => {
    expect(slug('demo:write')).toBe('demo.write')
  })
})

describe('runDirName', () => {
  it('combines a timestamp and the skill slug', () => {
    expect(runDirName('demo:write', new Date('2026-07-23T14:02:33Z')))
      .toBe('2026-07-23T14-02--demo.write')
  })

  it('is stable for the same instant', () => {
    const d = new Date('2026-07-23T14:02:33Z')
    expect(runDirName('a:b', d)).toBe(runDirName('a:b', d))
  })
})

describe('formatRecordSummary', () => {
  it('reports counts and the run id', () => {
    const s = formatRecordSummary({ written: 10, skipped: 2, errorRate: 0 }, 'r1')
    expect(s).toContain('10건 실행')
    expect(s).toContain('2건 건너뜀')
    expect(s).toContain('r1')
  })

  it('warns when the error rate exceeds 20%', () => {
    expect(formatRecordSummary({ written: 10, skipped: 0, errorRate: 0.3 }, 'r1'))
      .toContain('신뢰할 수 없습니다')
  })

  it('does not warn at or below 20%', () => {
    expect(formatRecordSummary({ written: 10, skipped: 0, errorRate: 0.2 }, 'r1'))
      .not.toContain('신뢰할 수 없습니다')
  })
})

describe('isQualityCase', () => {
  it('returns true for a case with must array', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, must: ['a'] }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns true for a case with must_not array', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, must_not: ['a'] }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns true for a case with qualitative: true', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, qualitative: true }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns false for a pure trigger case with no quality flags', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const }
    expect(isQualityCase(c)).toBe(false)
  })
})

describe('buildRecordPlan', () => {
  it('creates only "with" variants for pure trigger cases (3 repeats each)', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const }
    ]
    const plan = buildRecordPlan(cases)
    const c1Items = plan.filter(item => item.caseId === 'c1')
    expect(c1Items).toHaveLength(3)
    expect(c1Items.every(item => item.variant === 'with')).toBe(true)
    expect(c1Items.map(item => item.repeat).sort()).toEqual([1, 2, 3])
  })

  it('creates "with", "forced", and "without" variants for quality cases (with repeated 3x, others 1x)', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const, must: ['x'] }
    ]
    const plan = buildRecordPlan(cases)
    const withItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'with')
    const forcedItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'forced')
    const withoutItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'without')
    expect(withItems).toHaveLength(3)
    expect(forcedItems).toHaveLength(1)
    expect(withoutItems).toHaveLength(1)
  })

  it('handles a case with only qualitative: true as a quality case', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const, qualitative: true }
    ]
    const plan = buildRecordPlan(cases)
    const variants = new Set(plan.map(item => item.variant))
    expect(variants).toEqual(new Set(['with', 'forced', 'without']))
  })

  it('partitions mixed input correctly: trigger + quality', () => {
    const cases = [
      { id: 'trigger1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const },
      { id: 'quality1', prompt: 'test2', expect: 'trigger' as const, split: 'train' as const, must_not: ['y'] }
    ]
    const plan = buildRecordPlan(cases)

    // Trigger case should have only "with" (3x)
    const trigger1Items = plan.filter(item => item.caseId === 'trigger1')
    expect(trigger1Items).toHaveLength(3)
    expect(trigger1Items.every(item => item.variant === 'with')).toBe(true)

    // Quality case should have "with" (3x), "forced" (1x), "without" (1x)
    const quality1Items = plan.filter(item => item.caseId === 'quality1')
    expect(quality1Items).toHaveLength(5)

    // All case IDs must be present and no duplication
    const allCaseIds = plan.map(item => item.caseId)
    expect(new Set(allCaseIds)).toEqual(new Set(['trigger1', 'quality1']))
  })

  it('does not drop or double-count cases', () => {
    const cases = [
      { id: 'a', prompt: 'pa', expect: 'trigger' as const, split: 'train' as const },
      { id: 'b', prompt: 'pb', expect: 'trigger' as const, split: 'train' as const, must: ['x'] },
      { id: 'c', prompt: 'pc', expect: 'trigger' as const, split: 'train' as const }
    ]
    const plan = buildRecordPlan(cases)
    const caseIds = new Set(plan.map(item => item.caseId))
    expect(caseIds).toEqual(new Set(['a', 'b', 'c']))

    // a and c should each have exactly 3 items (trigger cases)
    expect(plan.filter(item => item.caseId === 'a')).toHaveLength(3)
    expect(plan.filter(item => item.caseId === 'c')).toHaveLength(3)
    // b should have 5 items (3 with + 1 forced + 1 without)
    expect(plan.filter(item => item.caseId === 'b')).toHaveLength(5)
  })
})
