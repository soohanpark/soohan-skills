import { describe, it, expect } from 'vitest'
import { buildArgs } from '../../scripts/eval/runtimes/claude'

const skill = { id: 'demo:write', dir: '/tmp/plugins/demo/skills/write' }

describe('buildArgs', () => {
  it('builds the with-variant with turn 1 cut and stream-json output', () => {
    const args = buildArgs('with', skill, 'MR 써줘')
    expect(args).toContain('-p')
    expect(args).toContain('MR 써줘')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')
    expect(args).toContain('--verbose')
    expect(args).toEqual(expect.arrayContaining(['--max-turns', '1']))
  })

  it('does not restrict tools in the with-variant', () => {
    const args = buildArgs('with', skill, 'x')
    expect(args).not.toContain('--disallowedTools')
  })

  it('blocks both the Skill tool and reads of the skill directory in the without-variant', () => {
    const args = buildArgs('without', skill, 'x')
    const i = args.indexOf('--disallowedTools')
    expect(i).toBeGreaterThan(-1)
    expect(args).toContain('Skill')
    expect(args).toContain(`Read(${skill.dir}/**)`)
  })

  it('does not cut turns in the without-variant — the baseline needs to finish', () => {
    const args = buildArgs('without', skill, 'x')
    expect(args).not.toContain('--max-turns')
  })

  it('falls back to blocking Read, Grep and Glob wholesale when degraded', () => {
    const args = buildArgs('without', skill, 'x', { degradedBaseline: true })
    expect(args).toContain('Skill')
    expect(args).toContain('Read')
    expect(args).toContain('Grep')
    expect(args).toContain('Glob')
    expect(args).not.toContain(`Read(${skill.dir}/**)`)
  })

  it('passes the prompt verbatim, including quotes and newlines', () => {
    const prompt = 'MR "본문" 써줘\n두 번째 줄'
    const args = buildArgs('with', skill, prompt)
    expect(args).toContain(prompt)
  })

  it('throws for the forced variant until it is implemented', () => {
    expect(() => buildArgs('forced', skill, 'x')).toThrow(/forced/)
  })
})
