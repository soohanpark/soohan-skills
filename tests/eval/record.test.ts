import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTransient, planRuns, recordAll } from '../../scripts/eval/record'
import type { EvalCase } from '../../scripts/eval/cases'
import type { ParsedRun } from '../../scripts/eval/parse'
import type { Exec } from '../../scripts/eval/runtimes/claude'

let out: string
const skill = { id: 'demo:write', dir: '/tmp/plugins/demo/skills/write' }

const cases: EvalCase[] = [
  { id: 'a', prompt: 'p-a', expect: 'trigger', split: 'train' },
  { id: 'b', prompt: 'p-b', expect: 'no-trigger', split: 'test' }
]

const okStream = [
  '{"type":"system","subtype":"init","model":"m","skills":["demo:write"]}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"demo:write"}}]}}',
  '{"type":"result","is_error":false,"terminal_reason":"success","total_cost_usd":0.1,"usage":{"input_tokens":10,"output_tokens":5},"result":"ok"}'
].join('\n')

const errStream = [
  '{"type":"system","subtype":"init","model":"m","skills":[]}',
  '{"type":"result","is_error":true,"terminal_reason":"api_error","total_cost_usd":0,"usage":{}}'
].join('\n')

const execOk: Exec = async () => ({ stdout: okStream, durationMs: 12 })
const noSleep = async () => {}

beforeEach(() => { out = mkdtempSync(join(tmpdir(), 'eval-record-')) })
afterEach(() => { rmSync(out, { recursive: true, force: true }) })

describe('planRuns', () => {
  it('produces one item per case × variant × repeat', () => {
    const plan = planRuns(cases, { variants: ['with'], repeats: 3 })
    expect(plan).toHaveLength(6)
  })

  it('names files as <variant>--<caseId>--r<N>.jsonl', () => {
    const plan = planRuns(cases, { variants: ['with'], repeats: 1 })
    expect(plan[0].file).toBe('with--a--r1.jsonl')
  })

  it('numbers repeats from 1', () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 2 })
    expect(plan.map(p => p.repeat)).toEqual([1, 2])
  })

  it('only runs quality variants once even when repeats is higher', () => {
    const plan = planRuns([cases[0]], { variants: ['with', 'without'], repeats: 3 })
    expect(plan.filter(p => p.variant === 'with')).toHaveLength(3)
    expect(plan.filter(p => p.variant === 'without')).toHaveLength(1)
  })
})

describe('recordAll', () => {
  it('writes one raw jsonl per plan item', async () => {
    const plan = planRuns(cases, { variants: ['with'], repeats: 1 })
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.written).toBe(2)
    expect(existsSync(join(out, 'with--a--r1.jsonl'))).toBe(true)
    expect(readFileSync(join(out, 'with--a--r1.jsonl'), 'utf8')).toBe(okStream)
  })

  it('writes an index with parsed status per item', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].caseId).toBe('a')
    expect(index[0].parsed.triggered).toBe(true)
    expect(index[0].parsed.status).toBe('ok')
  })

  it('writes meta.json capturing the competing skill list', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.skillId).toBe('demo:write')
    expect(meta.loadedSkills).toEqual(['demo:write'])
    expect(meta.model).toBe('m')
  })

  it('skips items whose raw file already exists', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'with--a--r1.jsonl'), okStream)
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.skipped).toBe(1)
    expect(res.written).toBe(0)
  })

  it('keeps going when one item fails and reports the error rate', async () => {
    const plan = planRuns(cases, { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => {
      n += 1
      return { stdout: n === 1 ? errStream : okStream, durationMs: 1 }
    }
    const res = await recordAll({ plan, skill, outDir: out, exec })
    expect(res.written).toBe(2)
    expect(res.errorRate).toBeCloseTo(0.5)
  })

  it('defaults degradedBaseline to true — the deny pattern does not work in -p mode', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.degradedBaseline).toBe(true)
  })

  it('honours an explicit degradedBaseline: false', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk, degradedBaseline: false })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.degradedBaseline).toBe(false)
  })

  it('records a thrown exec as an error item rather than aborting', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const exec: Exec = async () => { throw new Error('spawn failed') }
    const res = await recordAll({ plan, skill, outDir: out, exec })
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.status).toBe('error')
    expect(index[0].parsed.terminalReason).toMatch(/spawn failed/)
    expect(res.errorRate).toBe(1)
  })

  it('rebuilds a full index entry for a skipped item from its raw file on disk', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'with--a--r1.jsonl'), okStream)
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.skipped).toBe(1)
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index).toHaveLength(1)
    expect(index[0].caseId).toBe('a')
    expect(index[0].parsed.status).toBe('ok')
    expect(index[0].parsed.triggered).toBe(true)
    expect(index[0].durationMs).toBe(0)
  })

  it('creates no raw file on a thrown exec, so a later call retries and can succeed', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const failing: Exec = async () => { throw new Error('spawn failed') }
    await recordAll({ plan, skill, outDir: out, exec: failing })
    expect(existsSync(join(out, 'with--a--r1.jsonl'))).toBe(false)

    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.skipped).toBe(0)
    expect(res.written).toBe(1)
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.status).toBe('ok')
  })

  it('records meta.repoSha when supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk, repoSha: 'abc123' })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.repoSha).toBe('abc123')
  })

  it('defaults meta.repoSha to an empty string when not supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.repoSha).toBe('')
  })

  it('defaults meta.runtime to claude when not supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.runtime).toBe('claude')
  })

  it('records an explicit runtime when supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk, runtime: 'codex' })
    const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
    expect(meta.runtime).toBe('codex')
  })
})

describe('recordAll runtime injection (defaults to claude)', () => {
  it('defaults to buildArgs (claude) when buildArgsFn is omitted', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let seenArgs: string[] = []
    const exec: Exec = async (args) => { seenArgs = args; return { stdout: okStream, durationMs: 1 } }
    await recordAll({ plan, skill, outDir: out, exec })
    // claude buildArgs('with', ...) 는 -p <prompt> --max-turns 1 을 낳는다.
    expect(seenArgs).toContain('-p')
    expect(seenArgs).toContain('p-a')
    expect(seenArgs).toEqual(expect.arrayContaining(['--max-turns', '1']))
  })

  it('uses an injected buildArgsFn instead of the claude default when supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let seenArgs: string[] = []
    const exec: Exec = async (args) => { seenArgs = args; return { stdout: okStream, durationMs: 1 } }
    const fakeBuildArgs = () => ['exec', '--json', 'custom']
    await recordAll({ plan, skill, outDir: out, exec, buildArgsFn: fakeBuildArgs })
    expect(seenArgs).toEqual(['exec', '--json', 'custom'])
  })

  it('defaults to parseClaudeStream when parse is omitted — a codex parser would not recognise this stream', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await recordAll({ plan, skill, outDir: out, exec: execOk })
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.triggered).toBe(true)
    expect(index[0].parsed.model).toBe('m')
  })

  it('uses an injected parse function instead of the claude default when supplied', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const fakeParse = (): ParsedRun => ({
      triggered: true, skillReadFallback: false, finalText: 'custom',
      status: 'ok', terminalReason: 'completed', tokens: 0, costUsd: 0, model: '', loadedSkills: []
    })
    await recordAll({ plan, skill, outDir: out, exec: execOk, parse: fakeParse })
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.finalText).toBe('custom')
  })

  it('uses the injected parse function on the skip-existing-file path too', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'with--a--r1.jsonl'), okStream)
    const fakeParse = (): ParsedRun => ({
      triggered: true, skillReadFallback: false, finalText: 'from-skip-path',
      status: 'ok', terminalReason: 'completed', tokens: 0, costUsd: 0, model: '', loadedSkills: []
    })
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk, parse: fakeParse })
    expect(res.skipped).toBe(1)
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.finalText).toBe('from-skip-path')
  })
})

describe('isTransient', () => {
  it('treats rate limits as transient', () => {
    expect(isTransient('rate_limit_error')).toBe(true)
  })

  it('treats overload and connection resets as transient', () => {
    expect(isTransient('overloaded_error')).toBe(true)
    expect(isTransient('connect ECONNRESET')).toBe(true)
  })

  it('does not treat auth failures as transient — retrying will not help', () => {
    expect(isTransient('authentication_failed')).toBe(false)
  })

  it('does not treat max_turns as transient', () => {
    expect(isTransient('max_turns')).toBe(false)
  })
})

describe('retry', () => {
  const rateLimited = [
    '{"type":"system","subtype":"init","model":"m","skills":[]}',
    '{"type":"result","is_error":true,"terminal_reason":"rate_limit_error","total_cost_usd":0,"usage":{}}'
  ].join('\n')

  it('retries once on a transient failure and keeps the successful result', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => {
      n += 1
      return { stdout: n === 1 ? rateLimited : okStream, durationMs: 1 }
    }
    const res = await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(n).toBe(2)
    expect(res.errorRate).toBe(0)
  })

  it('does not retry a non-transient failure', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => { n += 1; return { stdout: errStream, durationMs: 1 } }
    await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(n).toBe(1)
  })

  it('gives up after one retry and records the error', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => { n += 1; return { stdout: rateLimited, durationMs: 1 } }
    const res = await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(n).toBe(2)
    expect(res.errorRate).toBe(1)
  })

  it('retries a thrown exec whose message is transient', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => {
      n += 1
      if (n === 1) throw new Error('connect ECONNRESET')
      return { stdout: okStream, durationMs: 1 }
    }
    const res = await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(n).toBe(2)
    expect(res.errorRate).toBe(0)
    expect(existsSync(join(out, 'with--a--r1.jsonl'))).toBe(true)
  })

  it('does not write a raw file when every attempt throws', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const exec: Exec = async () => { throw new Error('rate_limit_error') }
    const res = await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(existsSync(join(out, 'with--a--r1.jsonl'))).toBe(false)
    expect(res.errorRate).toBe(1)
  })

  it('records a timed-out exec with status timeout and does not retry it', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => { n += 1; throw new Error('claude timed out after 100ms') }
    const res = await recordAll({ plan, skill, outDir: out, exec, sleep: noSleep })
    expect(n).toBe(1)
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
    expect(index[0].parsed.status).toBe('timeout')
    expect(existsSync(join(out, 'with--a--r1.jsonl'))).toBe(false)
    expect(res.errorRate).toBe(1)
  })

  it('calls the injected sleep exactly once on a single retry', async () => {
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    let n = 0
    const exec: Exec = async () => {
      n += 1
      return { stdout: n === 1 ? rateLimited : okStream, durationMs: 1 }
    }
    let sleepCalls = 0
    const sleep = async (ms: number) => { sleepCalls += 1; expect(ms).toBeGreaterThan(0) }
    await recordAll({ plan, skill, outDir: out, exec, sleep })
    expect(sleepCalls).toBe(1)
  })
})

describe('recursion guard', () => {
  const origDepth = process.env.SKILL_EVAL_DEPTH
  afterEach(() => {
    if (origDepth === undefined) delete process.env.SKILL_EVAL_DEPTH
    else process.env.SKILL_EVAL_DEPTH = origDepth
  })

  it('refuses to run when already nested one level deep', async () => {
    process.env.SKILL_EVAL_DEPTH = '1'
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    await expect(recordAll({ plan, skill, outDir: out, exec: execOk }))
      .rejects.toThrow(/SKILL_EVAL_DEPTH/)
  })

  it('runs normally at depth 0', async () => {
    process.env.SKILL_EVAL_DEPTH = '0'
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.written).toBe(1)
  })

  it('runs normally when the variable is unset', async () => {
    delete process.env.SKILL_EVAL_DEPTH
    const plan = planRuns([cases[0]], { variants: ['with'], repeats: 1 })
    const res = await recordAll({ plan, skill, outDir: out, exec: execOk })
    expect(res.written).toBe(1)
  })
})
