import { describe, it, expect } from 'vitest'
import { buildArgs, execFailureReason } from '../../scripts/eval/runtimes/claude'

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

describe('execFailureReason', () => {
  it('returns null when stdout is present and exit code is 1 (max-turns boundary case)', () => {
    const outcome = { stdout: '{"event":"message","content":"hello"}', exitCode: 1, stderr: '' }
    expect(execFailureReason(outcome)).toBeNull()
  })

  it('returns null when stdout is present and exit code is 0', () => {
    const outcome = { stdout: '{"event":"message","content":"hello"}', exitCode: 0, stderr: '' }
    expect(execFailureReason(outcome)).toBeNull()
  })

  it('returns non-null when stdout is empty and exit code is non-zero', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('exit 1')
  })

  it('includes stderr text in the failure message when present', () => {
    const outcome = { stdout: '', exitCode: 127, stderr: 'command not found: claude' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('command not found: claude')
  })

  it('returns non-null message for empty stdout with no stderr', () => {
    const outcome = { stdout: '', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toBeTruthy()
  })

  it('handles signal termination (null exit code) with empty stdout', () => {
    const outcome = { stdout: '', exitCode: null, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('signal')
  })

  it('treats whitespace-only stdout as empty', () => {
    const outcome = { stdout: '   \n\t  ', exitCode: 1, stderr: '' }
    const reason = execFailureReason(outcome)
    expect(reason).not.toBeNull()
    expect(reason).toContain('exit 1')
  })
})
