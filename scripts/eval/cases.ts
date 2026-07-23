import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  expect: z.enum(['trigger', 'no-trigger']),
  split: z.enum(['train', 'test']).default('train'),
  source: z.string().optional(),
  must: z.array(z.string()).optional(),
  must_not: z.array(z.string()).optional(),
  qualitative: z.boolean().optional(),
  criteria: z.string().optional()
})

export type EvalCase = z.infer<typeof EvalCaseSchema>

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

    const result = EvalCaseSchema.safeParse(parsed)
    if (!result.success) {
      const detail = result.error.issues
        .map(iss => `${iss.path.join('.') || '<root>'}: ${iss.message}`)
        .join('; ')
      throw new Error(`${file} line ${lineNo}: ${detail}`)
    }

    if (seen.has(result.data.id)) {
      throw new Error(`${file} line ${lineNo}: duplicate case id "${result.data.id}"`)
    }
    seen.add(result.data.id)
    cases.push(result.data)
  }

  return cases
}
