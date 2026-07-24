import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planRuns, recordAll } from '../../scripts/eval/record'
import type { EvalCase } from '../../scripts/eval/cases'
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
