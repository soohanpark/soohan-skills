import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface EvalCase {
  id: string
  prompt: string
  expect: 'trigger' | 'no-trigger'
  split: 'train' | 'test'
  source?: string
  must?: string[]
  must_not?: string[]
  qualitative?: boolean
  criteria?: string
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string')

// zod 를 손 검증으로 대체했다 — 이 스크립트들은 설치된 스킬 디렉터리에서 node_modules 없이
// (npx tsx) 실행돼야 하므로 외부 의존성이 0이어야 한다. 알 수 없는 키를 버리는 것까지
// 기존 zod 동작과 동일하다 (tests/eval/cases.test.ts 가 계약을 고정한다).
const parseCase = (raw: unknown): { case: EvalCase } | { error: string } => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: '<root>: 객체가 아닙니다' }
  }
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return { error: 'id: 비어 있지 않은 문자열이 필요합니다' }
  if (typeof o.prompt !== 'string' || o.prompt === '') return { error: 'prompt: 비어 있지 않은 문자열이 필요합니다' }
  if (o.expect !== 'trigger' && o.expect !== 'no-trigger') return { error: "expect: 'trigger' 또는 'no-trigger' 여야 합니다" }
  // 기본값을 두면 안 된다. split 을 모르고 빠뜨리면 조용히 train 으로 들어가 test 분모가 0이 되고,
  // 판정 게이트가 전부 total > 0 으로 방어돼 있어 아무 사유도 안 쌓인 채 '합격'이 찍힌다
  // (외부 실측 보고 2026-07-28).
  const split = o.split
  if (split !== 'train' && split !== 'test') {
    return { error: "split: 'train' 또는 'test' 가 필요합니다 (필수 — test 가 판정 대상, train 은 튜닝용)" }
  }
  if (o.source !== undefined && typeof o.source !== 'string') return { error: 'source: 문자열이 필요합니다' }
  if (o.must !== undefined && !isStringArray(o.must)) return { error: 'must: 문자열 배열이 필요합니다' }
  if (o.must_not !== undefined && !isStringArray(o.must_not)) return { error: 'must_not: 문자열 배열이 필요합니다' }
  if (o.qualitative !== undefined && typeof o.qualitative !== 'boolean') return { error: 'qualitative: boolean 이 필요합니다' }
  if (o.criteria !== undefined && typeof o.criteria !== 'string') return { error: 'criteria: 문자열이 필요합니다' }

  return {
    case: {
      id: o.id,
      prompt: o.prompt,
      expect: o.expect,
      split,
      ...(o.source !== undefined && { source: o.source }),
      ...(o.must !== undefined && { must: o.must }),
      ...(o.must_not !== undefined && { must_not: o.must_not }),
      ...(o.qualitative !== undefined && { qualitative: o.qualitative }),
      ...(o.criteria !== undefined && { criteria: o.criteria })
    }
  }
}

// 케이스 파일의 지문. record 가 meta 에 남기고 report·judge 가 다시 계산해 대조한다 —
// 기록해 둔 런을 나중에 재채점할 때 그 사이 케이스가 바뀌었는지 알아낼 유일한 수단이다.
// (실측 보고자는 기록 후 split 만 지우고 report 를 다시 돌려 조용한 합격을 재현했다.)
// 지문에는 채점이 실제로 소비하는 필드가 전부 들어가야 한다. id·split·expect·prompt 만 넣으면
// must 를 지우거나 criteria 를 바꿔도 지문이 그대로라 드리프트가 안 잡힌다 — 판정을 뒤집는
// 편집이 흔적 없이 지나간다 (적대적 리뷰에서 확인).
// 접두사는 포맷 버전이다. 읽는 쪽은 자기가 재계산할 수 있는 포맷일 때만 대조하고, 그 외에는
// 조용히 넘긴다 — 거짓 경고가 쌓이면 진짜 경고까지 무시하게 된다.
export const CASES_HASH_PREFIX = 'v3:'

export const hashCases = (cases: EvalCase[]): string =>
  CASES_HASH_PREFIX + createHash('sha256')
    .update(cases.map(c => [
      c.id, c.split, c.expect, c.prompt,
      JSON.stringify(c.must ?? []), JSON.stringify(c.must_not ?? []),
      String(c.qualitative ?? false), c.criteria ?? ''
    ].join('\u0000')).join('\n'))
    .digest('hex')
    .slice(0, 12)

// 기록된 지문과 지금 케이스 파일이 어긋났는가. 접두사 없는 구 해시(plan 기반)는 재계산할 수
// 없으므로 조용히 넘긴다 — 거짓 경고가 쌓이면 진짜 경고까지 무시하게 된다.
export const casesDrifted = (recordedHash: string | undefined, current: string): boolean =>
  typeof recordedHash === 'string' && recordedHash.startsWith(CASES_HASH_PREFIX) && recordedHash !== current

export const loadCases = (file: string): EvalCase[] => {
  const lines = readFileSync(file, 'utf8').split('\n')
  const cases: EvalCase[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    const lineNo = i + 1

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (e) {
      throw new Error(`${file} line ${lineNo}: invalid JSON — ${(e as Error).message}`)
    }

    const result = parseCase(parsed)
    if ('error' in result) {
      throw new Error(`${file} line ${lineNo}: ${result.error}`)
    }

    if (seen.has(result.case.id)) {
      throw new Error(`${file} line ${lineNo}: duplicate case id "${result.case.id}"`)
    }
    seen.add(result.case.id)
    cases.push(result.case)
  }

  return cases
}
