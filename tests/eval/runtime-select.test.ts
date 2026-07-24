import { describe, it, expect } from 'vitest'
import { buildRecordPlan, parseRecordFlags, parseRuntimeFlag, RUNTIMES } from '../../scripts/eval/commands/record'
import type { EvalCase } from '../../scripts/eval/cases'

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
