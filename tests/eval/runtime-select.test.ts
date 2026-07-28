import { describe, it, expect } from 'vitest'
import { buildRecordPlan, checkResume, parseRecordFlags, parseRuntimeFlag, RUNTIMES } from '../../plugins/skill-eval/skills/score/scripts/commands/record'
import type { EvalCase } from '../../plugins/skill-eval/skills/score/scripts/cases'

describe('parseRecordFlags', () => {
  it('extracts --runtime and --resume regardless of order', () => {
    expect(parseRecordFlags(['--resume=2026-07-24T10-00--demo.write', '--runtime=codex']))
      .toEqual({ runtime: '--runtime=codex', resume: '2026-07-24T10-00--demo.write' })
    expect(parseRecordFlags(['--runtime=codex', '--resume=r1']).resume).toBe('r1')
  })

  it('accepts a bare runtime name', () => {
    expect(parseRecordFlags(['codex'])).toEqual({ runtime: 'codex', resume: undefined })
  })

  it('returns neither when no flags are given', () => {
    expect(parseRecordFlags([])).toEqual({ runtime: undefined, resume: undefined })
  })

  it('throws on an unrecognized flag — a typo like --reusme must not mint a fresh full run', () => {
    expect(() => parseRecordFlags(['--reusme=r1'])).toThrow(/reusme/)
  })
})

describe('checkResume', () => {
  it('returns the resumed runtime, defaulting claude for runs recorded before the field existed', () => {
    expect(checkResume({ skillId: 'a:b', runtime: 'codex' }, 'a:b', undefined)).toBe('codex')
    expect(checkResume({ skillId: 'a:b' }, 'a:b', undefined)).toBe('claude')
  })

  it('throws when the resume target belongs to a different skill', () => {
    expect(() => checkResume({ skillId: 'a:b', runtime: 'claude' }, 'c:d', undefined)).toThrow(/a:b/)
  })

  it('throws when an explicit --runtime contradicts the resumed runtime', () => {
    expect(() => checkResume({ skillId: 'a:b', runtime: 'codex' }, 'a:b', '--runtime=claude')).toThrow(/codex/)
  })

  it('accepts an explicit --runtime that matches the resumed runtime', () => {
    expect(checkResume({ skillId: 'a:b', runtime: 'codex' }, 'a:b', '--runtime=codex')).toBe('codex')
  })

  // 재개는 이미 적재된 원본을 그대로 재파싱한다. 그 사이 케이스를 고치면 옛 프롬프트에 대한
  // 응답이 새 프롬프트의 측정 결과로 index 에 들어가고, 지문은 새 값으로 덮여 흔적도 안 남는다.
  it('refuses to resume once the case file has changed', () => {
    expect(() => checkResume({ skillId: 'a:b', casesHash: 'v2:aaaaaaaaaaaa' }, 'a:b', undefined, 'v2:bbbbbbbbbbbb'))
      .toThrow(/케이스/)
  })

  it('resumes when the case file is unchanged', () => {
    expect(checkResume({ skillId: 'a:b', casesHash: 'v2:aaaaaaaaaaaa' }, 'a:b', undefined, 'v2:aaaaaaaaaaaa'))
      .toBe('claude')
  })

  it('resumes a run recorded before the v2 fingerprint existed', () => {
    expect(checkResume({ skillId: 'a:b', casesHash: 'deadbeef1234' }, 'a:b', undefined, 'v2:bbbbbbbbbbbb'))
      .toBe('claude')
  })
})

describe('parseRuntimeFlag', () => {
  it('reads an explicit --runtime=codex', () => {
    expect(parseRuntimeFlag('--runtime=codex', 'claude')).toBe('codex')
  })

  it('reads a bare runtime name', () => {
    expect(parseRuntimeFlag('codex', 'claude')).toBe('codex')
  })

  it('falls back to the detected runtime when the flag is absent', () => {
    expect(parseRuntimeFlag(undefined, 'claude')).toBe('claude')
  })

  it('throws on an unrecognized explicit value — a typo must not silently run the wrong runtime for minutes', () => {
    expect(() => parseRuntimeFlag('--runtime=gemini', 'codex')).toThrow(/gemini/)
  })

  it('reads an explicit --runtime=claude even when something else was detected', () => {
    expect(parseRuntimeFlag('--runtime=claude', 'codex')).toBe('claude')
  })
})

describe('RUNTIMES', () => {
  it('registers claude with all three quality variants', () => {
    expect(RUNTIMES.claude.qualityVariants).toEqual(['with', 'forced', 'without'])
  })

  it('registers codex without the unsupported without variant', () => {
    expect(RUNTIMES.codex.qualityVariants).toEqual(['with', 'forced'])
    expect(RUNTIMES.codex.qualityVariants).not.toContain('without')
  })

  it('names each adapter after its own runtime', () => {
    expect(RUNTIMES.claude.name).toBe('claude')
    expect(RUNTIMES.codex.name).toBe('codex')
  })

  it('wires each adapter to callable exec/buildArgs/parse functions', () => {
    expect(typeof RUNTIMES.claude.exec).toBe('function')
    expect(typeof RUNTIMES.claude.buildArgs).toBe('function')
    expect(typeof RUNTIMES.claude.parse).toBe('function')
    expect(typeof RUNTIMES.codex.exec).toBe('function')
    expect(typeof RUNTIMES.codex.buildArgs).toBe('function')
    expect(typeof RUNTIMES.codex.parse).toBe('function')
  })
})

describe('buildRecordPlan qualityVariants', () => {
  const quality: EvalCase = { id: 'q', prompt: 'x', expect: 'trigger', split: 'test', qualitative: true }

  it('omits without for a codex-style variant set', () => {
    const plan = buildRecordPlan([quality], ['with', 'forced'])
    expect(plan.some(p => p.variant === 'without')).toBe(false)
    expect(plan.some(p => p.variant === 'forced')).toBe(true)
  })

  it('defaults to all three when no variant set is given', () => {
    const plan = buildRecordPlan([quality])
    expect(plan.some(p => p.variant === 'without')).toBe(true)
  })
})
