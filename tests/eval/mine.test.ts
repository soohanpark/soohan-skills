import { describe, it, expect } from 'vitest'
import {
  extractPrompts, classify, toDraftCases, keywordsFromDescription
} from '../../plugins/skill-eval/skills/score/scripts/mine'
import { buildAugmentPrompt, parseVariants, attachVariants } from '../../plugins/skill-eval/skills/score/scripts/mine'
import type { EvalCase } from '../../plugins/skill-eval/skills/score/scripts/cases'

const session = [
  '{"type":"user","message":{"role":"user","content":"블인팀 MR 내용 작성해줘"}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"blin-mr:write"}}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"커밋 로그만 정리해줘"}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"정리했습니다"}]}}'
].join('\n')

describe('extractPrompts', () => {
  it('extracts user prompts from both string and block content forms', () => {
    const out = extractPrompts(session, 's1.jsonl')
    expect(out.map(o => o.prompt)).toEqual(['블인팀 MR 내용 작성해줘', '커밋 로그만 정리해줘'])
  })

  it('attaches the skills triggered after each prompt', () => {
    const out = extractPrompts(session, 's1.jsonl')
    expect(out[0].triggeredSkills).toEqual(['blin-mr:write'])
    expect(out[1].triggeredSkills).toEqual([])
  })

  it('records the source session file', () => {
    expect(extractPrompts(session, 's1.jsonl')[0].sessionFile).toBe('s1.jsonl')
  })

  it('ignores tool_result blocks that are shaped like user messages', () => {
    const raw = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"결과"}]}}'
    expect(extractPrompts(raw, 's.jsonl')).toEqual([])
  })

  it('ignores malformed lines', () => {
    expect(extractPrompts('not json\n' + session, 's1.jsonl')).toHaveLength(2)
  })
})

describe('keywordsFromDescription', () => {
  it('pulls quoted example phrases out of a description', () => {
    const kws = keywordsFromDescription('Use when the user asks for MR content (e.g. "MR 본문 정리해줘", "블인 MR 써줘").')
    expect(kws).toContain('MR 본문 정리해줘')
    expect(kws).toContain('블인 MR 써줘')
  })

  it('returns [] when there are no quoted phrases', () => {
    expect(keywordsFromDescription('설명만 있고 예시는 없다')).toEqual([])
  })
})

describe('classify', () => {
  const mined = [
    { prompt: 'MR 써줘', triggeredSkills: ['blin-mr:write'], sessionFile: 'a' },
    { prompt: 'MR 말고 커밋 로그만 정리해줘', triggeredSkills: [], sessionFile: 'b' },
    { prompt: '점심 메뉴 추천해줘', triggeredSkills: [], sessionFile: 'c' }
  ]

  it('takes prompts that actually triggered the skill as positives', () => {
    const r = classify(mined, { skillId: 'blin-mr:write', keywords: ['MR'] })
    expect(r.positives.map(p => p.prompt)).toEqual(['MR 써줘'])
  })

  it('takes keyword-matching non-triggers as near misses', () => {
    const r = classify(mined, { skillId: 'blin-mr:write', keywords: ['MR'] })
    expect(r.nearMisses.map(p => p.prompt)).toEqual(['MR 말고 커밋 로그만 정리해줘'])
  })

  it('drops prompts unrelated to the skill — they verify nothing', () => {
    const r = classify(mined, { skillId: 'blin-mr:write', keywords: ['MR'] })
    expect(r.nearMisses.some(p => p.prompt.includes('점심'))).toBe(false)
  })

  it('deduplicates identical prompts', () => {
    const dup = [...mined, { prompt: 'MR 써줘', triggeredSkills: ['blin-mr:write'], sessionFile: 'd' }]
    const r = classify(dup, { skillId: 'blin-mr:write', keywords: ['MR'] })
    expect(r.positives).toHaveLength(1)
  })
})

describe('toDraftCases', () => {
  const input = {
    positives: [{ prompt: 'MR 써줘', triggeredSkills: ['x'], sessionFile: 'a' }],
    nearMisses: [{ prompt: '커밋 로그만', triggeredSkills: [], sessionFile: 'b' }]
  }

  it('assigns expect based on which bucket the prompt came from', () => {
    const cases = toDraftCases(input)
    expect(cases.find(c => c.prompt === 'MR 써줘')!.expect).toBe('trigger')
    expect(cases.find(c => c.prompt === '커밋 로그만')!.expect).toBe('no-trigger')
  })

  it('tags near misses in the source field so they can be reviewed first', () => {
    const c = toDraftCases(input).find(c => c.expect === 'no-trigger')!
    expect(c.source).toMatch(/near-miss/)
  })

  it('gives every case a unique id', () => {
    const ids = toDraftCases(input).map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('splits originals so that train and test are both populated', () => {
    const many = {
      positives: Array.from({ length: 6 }, (_, i) => ({ prompt: `p${i}`, triggeredSkills: ['x'], sessionFile: 'a' })),
      nearMisses: []
    }
    const cases = toDraftCases(many)
    expect(cases.some(c => c.split === 'train')).toBe(true)
    expect(cases.some(c => c.split === 'test')).toBe(true)
  })
})

describe('buildAugmentPrompt', () => {
  it('asks only for rewordings, never for new scenarios', () => {
    const p = buildAugmentPrompt('MR 써줘', 3)
    expect(p).toContain('MR 써줘')
    expect(p).toMatch(/표현만/)
    // 금지 규칙 자체를 검증한다 — 어휘 존재가 아니라 부정형이 있어야 한다.
    expect(p).toMatch(/만들지 마라|추가하지 마라|하지 마라/)
    expect(p).not.toMatch(/만들어도 (된다|좋다)|추가해도 (된다|좋다)/)
  })

  it('requests the given number of variants as a JSON array', () => {
    expect(buildAugmentPrompt('x', 3)).toMatch(/3개/)
    expect(buildAugmentPrompt('x', 3)).toMatch(/JSON/)
  })
})

describe('parseVariants', () => {
  it('reads a JSON array of strings', () => {
    expect(parseVariants('["a","b"]')).toEqual(['a', 'b'])
  })

  it('reads an array embedded in surrounding prose', () => {
    expect(parseVariants('결과:\n["a","b"]\n끝')).toEqual(['a', 'b'])
  })

  it('returns [] for unparseable output rather than throwing', () => {
    expect(parseVariants('모르겠습니다')).toEqual([])
  })

  it('drops non-string entries', () => {
    expect(parseVariants('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })
})

describe('attachVariants', () => {
  const original: EvalCase = { id: 'p-001', prompt: '원본', expect: 'trigger', split: 'test', source: 'log:s1' }

  it('inherits split from the original so the two splits never share an origin', () => {
    const out = attachVariants(original, ['변형1', '변형2'])
    expect(out.every(c => c.split === 'test')).toBe(true)
  })

  it('inherits expect from the original', () => {
    expect(attachVariants(original, ['v']).every(c => c.expect === 'trigger')).toBe(true)
  })

  it('derives ids from the original id', () => {
    expect(attachVariants(original, ['a', 'b']).map(c => c.id)).toEqual(['p-001-v1', 'p-001-v2'])
  })

  it('marks the source so augmented cases are distinguishable from mined ones', () => {
    expect(attachVariants(original, ['a'])[0].source).toBe('llm:variant-of:p-001')
  })

  it('returns [] when there are no variants', () => {
    expect(attachVariants(original, [])).toEqual([])
  })
})

// 하네스가 로그에 끼워 넣는 type:"user" 이벤트(슬래시커맨드 확장, caveat, system-reminder)가
// 실사용 발화로 채굴됐다. 끼어든 이벤트가 current 를 갈아치우는 바람에 뒤따르는 Skill 호출이
// 그 가짜 프롬프트에 귀속되고, 진짜 발화는 triggeredSkills=[] 가 되어 negative 로 라벨링됐다.
// 실제로 로컬 draft 에 "블인팀 MR 내용 작성해줘" 가 no-trigger 로 들어가 있었다.
describe('extractPrompts · 하네스가 만든 이벤트', () => {
  const line = (o: unknown) => JSON.stringify(o)
  const user = (text: string, over: Record<string, unknown> = {}) =>
    line({ type: 'user', message: { content: [{ type: 'text', text }] }, ...over })
  const skillCall = (skill: string) =>
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } })

  it('does not let a slash-command expansion steal the trigger from the real prompt', () => {
    const jsonl = [
      user('블인팀 MR 내용 작성해줘'),
      user('The user invoked `/blin-mr` (full identifier: `/blin-mr:blin-mr`).\n\nActivate the skill.'),
      skillCall('blin-mr:write')
    ].join('\n')
    const mined = extractPrompts(jsonl, 's.jsonl')
    expect(mined).toHaveLength(1)
    expect(mined[0].prompt).toBe('블인팀 MR 내용 작성해줘')
    expect(mined[0].triggeredSkills).toEqual(['blin-mr:write'])
  })

  it('skips local-command caveats and stdout echoes', () => {
    const jsonl = [
      user('MR 써줘'),
      user('<local-command-caveat>Caveat: generated while running local commands</local-command-caveat>'),
      user('<command-name>/model</command-name>'),
      user('<local-command-stdout>Set model to Opus</local-command-stdout>'),
      skillCall('blin-mr:write')
    ].join('\n')
    const mined = extractPrompts(jsonl, 's.jsonl')
    expect(mined.map(m => m.prompt)).toEqual(['MR 써줘'])
    expect(mined[0].triggeredSkills).toEqual(['blin-mr:write'])
  })

  it('skips events the harness marked as meta', () => {
    const jsonl = [user('진짜 발화'), user('주입된 컨텍스트', { isMeta: true })].join('\n')
    expect(extractPrompts(jsonl, 's.jsonl').map(m => m.prompt)).toEqual(['진짜 발화'])
  })

  it('skips injected system reminders', () => {
    const jsonl = [user('진짜 발화'), user('<system-reminder>배경 정보</system-reminder>')].join('\n')
    expect(extractPrompts(jsonl, 's.jsonl').map(m => m.prompt)).toEqual(['진짜 발화'])
  })

  it('still records a genuine prompt that merely mentions a skill name', () => {
    const jsonl = [user('blin-mr 스킬 고쳐줘')].join('\n')
    expect(extractPrompts(jsonl, 's.jsonl')).toHaveLength(1)
  })
})

// 같은 문구가 두 세션에 있고 한쪽만 발동했다면, 첫 등장으로 라벨을 고정하는 것은
// readdir 순서에 판정을 맡기는 것이다 — 실제로 발동하는 프롬프트가 negative 로 굳을 수 있다.
describe('classify · 중복 프롬프트의 라벨', () => {
  const m = (prompt: string, skills: string[] = []) =>
    ({ prompt, triggeredSkills: skills, sessionFile: 's.jsonl' })

  it('adopts the occurrence that fired, whatever order the sessions were read in', () => {
    const args = { skillId: 'demo:write', keywords: ['MR'] }
    const notFirst = classify([m('MR 써줘'), m('MR 써줘', ['demo:write'])], args)
    const firedFirst = classify([m('MR 써줘', ['demo:write']), m('MR 써줘')], args)
    expect(notFirst.positives.map(p => p.prompt)).toEqual(['MR 써줘'])
    expect(notFirst.nearMisses).toEqual([])
    expect(firedFirst.positives.map(p => p.prompt)).toEqual(['MR 써줘'])
  })

  it('still treats a prompt that never fired as a near-miss when a keyword matches', () => {
    const r = classify([m('MR 써줘'), m('MR 써줘')], { skillId: 'demo:write', keywords: ['MR'] })
    expect(r.positives).toEqual([])
    expect(r.nearMisses).toHaveLength(1)
  })
})
