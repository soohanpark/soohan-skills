import { z } from 'zod'

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const KebabCaseString = z.string().regex(KEBAB_CASE, 'must be kebab-case')

export const PluginManifestSchema = z.object({
  name: KebabCaseString,
  version: z.string().regex(SEMVER, 'must be semver (e.g. 1.2.3)'),
  description: z.string().min(1, 'must be non-empty'),
  author: z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    url: z.string().url().optional()
  }),
  category: KebabCaseString,
  tags: z.array(KebabCaseString).min(1, 'must contain at least one tag'),
  homepage: z.string().url().optional(),
  license: z.string().min(1).optional()
}).strict()

export type PluginManifest = z.infer<typeof PluginManifestSchema>
