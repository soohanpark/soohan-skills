import type { EvalCase } from './cases.js'

const REGEX_FORM = /^\/(.*)\/([gimsuy]*)$/

const matches = (text: string, rule: string): boolean => {
  const m = REGEX_FORM.exec(rule)
  if (m) {
    try {
      return new RegExp(m[1], m[2]).test(text)
    } catch {
      // 잘못된 패턴(예: must: ["/api/v1(beta/"]) 하나가 report 전체를 죽이면 안 된다.
      // 정규식으로 못 읽으면 애초에 리터럴이었을 가능성이 높으므로 그렇게 취급한다.
      return text.includes(rule)
    }
  }
  return text.includes(rule)
}

export const checkRules = (
  text: string,
  c: Pick<EvalCase, 'must' | 'must_not'>
): { passed: boolean; failures: string[] } => {
  const failures: string[] = []

  for (const rule of c.must ?? []) {
    if (!matches(text, rule)) failures.push(`must 누락: "${rule}"`)
  }
  for (const rule of c.must_not ?? []) {
    if (matches(text, rule)) failures.push(`must_not 위반: "${rule}"`)
  }

  return { passed: failures.length === 0, failures }
}
