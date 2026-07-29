import { describe, it, expect } from 'vitest'
import {
  buildJudgeArgs, buildJudgePrompt, deriveCriteria, isJudgeTrustworthy, isRationaleOnTopic, parseVerdict, readJudgeCheck, resolvePair, scorePairwise, skillDescription
} from '../../plugins/skill-eval/skills/score/scripts/judge'
import type { EvalCase } from '../../plugins/skill-eval/skills/score/scripts/cases'

const base: EvalCase = { id: 'q1', prompt: 'x', expect: 'trigger', split: 'test' }

describe('deriveCriteria', () => {
  it('prefers the case criteria when present', () => {
    const c = { ...base, criteria: '템플릿 섹션을 모두 채웠는가' }
    expect(deriveCriteria(c, '스킬 설명')).toBe('템플릿 섹션을 모두 채웠는가')
  })

  it('falls back to the skill description', () => {
    expect(deriveCriteria(base, 'MR 본문을 하십시오체로 작성한다')).toContain('하십시오체')
  })
})

describe('skillDescription', () => {
  it('extracts only the description value from frontmatter', () => {
    const md = '---\nname: score\ndescription: MR 본문을 하십시오체로 작성한다\n---\n\n# 본문'
    expect(skillDescription(md)).toBe('MR 본문을 하십시오체로 작성한다')
    expect(skillDescription(md)).not.toContain('score')
  })

  it('strips surrounding quotes', () => {
    expect(skillDescription('---\ndescription: "따옴표 설명"\n---\n')).toBe('따옴표 설명')
  })

  it('returns empty when no description key exists — never the whole frontmatter', () => {
    expect(skillDescription('---\nname: run\n---\n')).toBe('')
  })
})

describe('buildJudgeArgs', () => {
  it('caps the judge session at one turn — a text verdict needs no more', () => {
    expect(buildJudgeArgs('p')).toEqual(expect.arrayContaining(['--max-turns', '1']))
  })

  it('disallows tools — the prompt embeds untrusted transcripts', () => {
    const args = buildJudgeArgs('p')
    expect(args.indexOf('--disallowedTools')).toBeGreaterThan(-1)
    expect(args).toContain('Bash')
    expect(args).toContain('Skill')
  })

  it('passes the prompt and requests stream-json output', () => {
    const args = buildJudgeArgs('기준으로 비교하라')
    expect(args).toContain('기준으로 비교하라')
    expect(args).toContain('stream-json')
  })
})

describe('buildJudgePrompt', () => {
  it('includes the criteria and both outputs without revealing which is which', () => {
    const p = buildJudgePrompt({ criteria: '기준X', a: '출력1', b: '출력2' })
    expect(p).toContain('기준X')
    expect(p).toContain('출력1')
    expect(p).toContain('출력2')
    expect(p).not.toMatch(/스킬 적용|baseline|with-skill/)
  })

  it('asks for one of A, B or tie plus a one-sentence rationale', () => {
    const p = buildJudgePrompt({ criteria: 'c', a: '1', b: '2' })
    expect(p).toMatch(/\bA\b/)
    expect(p).toMatch(/\bB\b/)
    expect(p).toMatch(/tie/)
    expect(p).toMatch(/근거/)
  })
})

describe('parseVerdict', () => {
  it('reads a JSON verdict', () => {
    const r = parseVerdict('{"verdict":"A","rationale":"A가 기준을 더 충족한다"}')
    expect(r.verdict).toBe('A')
    expect(r.rationale).toBe('A가 기준을 더 충족한다')
  })

  it('reads a JSON verdict embedded in surrounding prose', () => {
    const r = parseVerdict('결과입니다:\n{"verdict":"B","rationale":"이유"}\n끝')
    expect(r.verdict).toBe('B')
  })

  it('returns tie for unparseable output', () => {
    expect(parseVerdict('음... 잘 모르겠습니다').verdict).toBe('tie')
  })

  it('returns tie for an out-of-range verdict value', () => {
    expect(parseVerdict('{"verdict":"C","rationale":"x"}').verdict).toBe('tie')
  })
})

describe('isRationaleOnTopic', () => {
  it('accepts a rationale that shares vocabulary with the criteria', () => {
    expect(isRationaleOnTopic('템플릿 섹션을 빠짐없이 채웠다', '템플릿 섹션을 모두 채웠는가')).toBe(true)
  })

  it('rejects a rationale that argues something outside the criteria', () => {
    expect(isRationaleOnTopic('A가 더 친절하고 상냥하다', '템플릿 섹션을 모두 채웠는가')).toBe(false)
  })

  it('rejects an empty rationale', () => {
    expect(isRationaleOnTopic('', '기준')).toBe(false)
  })
})

describe('resolvePair', () => {
  it('gives the skill the win when both orderings agree', () => {
    // 1회차: forced=A 이고 A 승. 2회차: 순서를 뒤집어 forced=B 이고 B 승.
    expect(resolvePair('A', 'B')).toBe('skill')
  })

  it('gives the baseline the win when both orderings agree the other way', () => {
    expect(resolvePair('B', 'A')).toBe('baseline')
  })

  it('returns tie when the two orderings disagree — position bias', () => {
    expect(resolvePair('A', 'A')).toBe('tie')
    expect(resolvePair('B', 'B')).toBe('tie')
  })

  it('returns tie when either ordering said tie', () => {
    expect(resolvePair('tie', 'B')).toBe('tie')
    expect(resolvePair('A', 'tie')).toBe('tie')
  })
})

describe('isJudgeTrustworthy', () => {
  it('trusts a judge that ties on identical outputs', () => {
    expect(isJudgeTrustworthy({ verdict: 'tie', rationale: '차이가 없다' })).toBe(true)
  })

  it('rejects a judge that picks A when both sides are the same text', () => {
    expect(isJudgeTrustworthy({ verdict: 'A', rationale: 'A가 낫다' })).toBe(false)
  })

  it('rejects a judge that picks B when both sides are the same text', () => {
    expect(isJudgeTrustworthy({ verdict: 'B', rationale: 'B가 낫다' })).toBe(false)
  })

  it('rejects a tie with no rationale — an unparseable answer is not a real tie', () => {
    expect(isJudgeTrustworthy({ verdict: 'tie', rationale: '' })).toBe(false)
  })
})

describe('scorePairwise', () => {
  // split 은 기본 'test' — 대부분의 기존 케이스는 test split 판정이 게이트에 그대로 반영되는지를 본다.
  const outcomes = (list: ('skill' | 'baseline' | 'tie')[]) =>
    list.map((o, i) => ({ caseId: `q${i}`, split: 'test' as const, outcome: o, discarded: false }))

  it('computes the win rate excluding ties', () => {
    const s = scorePairwise(outcomes(['skill', 'skill', 'skill', 'tie', 'baseline']))
    expect(s.win).toBe(3)
    expect(s.loss).toBe(1)
    expect(s.tie).toBe(1)
    expect(s.rate).toBeCloseTo(0.75)
  })

  it('excludes discarded verdicts from every count', () => {
    const list = [...outcomes(['skill']), { caseId: 'x', split: 'test' as const, outcome: 'skill' as const, discarded: true }]
    const s = scorePairwise(list)
    expect(s.win).toBe(1)
    expect(s.discarded).toBe(1)
  })

  it('returns a null rate when every pair tied — nothing to conclude', () => {
    expect(scorePairwise(outcomes(['tie', 'tie'])).rate).toBeNull()
  })

  // 설계 §7-3: 페어와이즈 승률은 트리거·규칙 축과 마찬가지로 test split 에서만 판정을 가른다.
  // train 케이스가 합격/불합격을 뒤집으면 안 된다.
  it('excludes a train-split pair from the rate — a train baseline win does not offset a test skill win', () => {
    const list = [
      { caseId: 'train-1', split: 'train' as const, outcome: 'baseline' as const, discarded: false },
      { caseId: 'test-1', split: 'test' as const, outcome: 'skill' as const, discarded: false }
    ]
    const s = scorePairwise(list)
    expect(s.rate).toBe(1)
    expect(s.win).toBe(1)
    expect(s.loss).toBe(0)
  })
})

// 못 찾았을 때 프론트매터 전체를 돌려주면 name·allowed-tools 같은 메타데이터가 심판 기준이 되고,
// isRationaleOnTopic 이 그 잡음과의 겹침만으로 근거를 통과시켜 폐기 필터가 무력화된다.
// 바로 위 주석이 금지한 동작을 폴백이 하고 있었다.
describe('skillDescription · 못 찾았을 때', () => {
  const md = (body: string) => `---\n${body}\n---\n\n# 본문\n`

  it('reads a folded YAML block, which external skills commonly use', () => {
    const d = skillDescription(md('name: run\ndescription: >-\n  첫 줄이다.\n  둘째 줄이다.\nallowed-tools: Bash'))
    expect(d).toBe('첫 줄이다. 둘째 줄이다.')
  })

  it('reads a literal YAML block too', () => {
    expect(skillDescription(md('name: run\ndescription: |\n  한 줄짜리 설명'))).toBe('한 줄짜리 설명')
  })

  it('returns empty rather than handing the whole frontmatter to the judge', () => {
    const d = skillDescription(md('name: run\nallowed-tools: Bash(git:*)\nlicense: MIT'))
    expect(d).toBe('')
    expect(d).not.toContain('allowed-tools')
  })

  it('returns empty when there is no frontmatter at all', () => {
    expect(skillDescription('# 그냥 마크다운')).toBe('')
  })
})

describe('readJudgeCheck', () => {
  it('passes a modern tri-state value through', () => {
    expect(readJudgeCheck({ judgeCheck: 'trusted' })).toBe('trusted')
    expect(readJudgeCheck({ judgeCheck: 'untrusted' })).toBe('untrusted')
    expect(readJudgeCheck({ judgeCheck: 'unchecked' })).toBe('unchecked')
  })

  it('maps a legacy false to untrusted', () => {
    expect(readJudgeCheck({ judgeTrustworthy: false })).toBe('untrusted')
  })

  // 구 파일의 true 는 "검사하고 통과" 와 "검사 자체를 안 함" 이 섞인 값이다.
  // 낙관해서 'trusted' 로 읽으면 없던 신뢰가 재채점 때 생긴다.
  it('refuses to read a legacy true as trusted — it could not tell the two apart', () => {
    expect(readJudgeCheck({ judgeTrustworthy: true })).toBe('unchecked')
  })

  it('defaults to unchecked for a file with neither field', () => {
    expect(readJudgeCheck({})).toBe('unchecked')
  })
})

// 심판 프롬프트에는 녹화된 남의 출력이 그대로 들어간다 — 이 하네스에서 프롬프트 인젝션
// 표면이 가장 넓은 지점이다. 도구 목록만 막아서는 MCP 116개가 그대로 열려 있었다.
describe('buildJudgeArgs · 인젝션 표면', () => {
  it('cuts MCP servers off', () => {
    expect(buildJudgeArgs('x')).toContain('--strict-mcp-config')
  })

  it('denies tools whose effects outlive the judgement', () => {
    const args = buildJudgeArgs('x')
    for (const tool of ['CronCreate', 'RemoteTrigger', 'PushNotification', 'SendMessage', 'Task', 'Workflow']) {
      expect(args, tool).toContain(tool)
    }
  })

  it('keeps the original lock — one turn and no file or network access', () => {
    const args = buildJudgeArgs('x')
    expect(args).toEqual(expect.arrayContaining(['--max-turns', '1']))
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Skill']) {
      expect(args, tool).toContain(tool)
    }
  })

  it('passes exactly one --disallowedTools', () => {
    expect(buildJudgeArgs('x').filter(a => a === '--disallowedTools')).toHaveLength(1)
  })
})
