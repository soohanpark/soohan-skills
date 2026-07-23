import { describe, it, expect } from 'vitest'
import { resolveSkill, slug, runDirName } from '../../scripts/eval/paths'
import { formatRecordSummary } from '../../scripts/eval/commands/record'

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
