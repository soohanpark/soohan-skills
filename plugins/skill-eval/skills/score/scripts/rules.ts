import type { EvalCase } from './cases.js'

const REGEX_FORM = /^\/(.*)\/([gimsuy]*)$/

const matches = (text: string, rule: string): boolean => {
  const m = REGEX_FORM.exec(rule)
  if (m) return new RegExp(m[1], m[2]).test(text)
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
