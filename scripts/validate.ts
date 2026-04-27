import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginManifestSchema } from './schema.js'

interface ValidationError {
  plugin: string
  message: string
}

export const validateAll = (root: string): ValidationError[] => {
  const errors: ValidationError[] = []
  const pluginsRoot = join(root, 'plugins')

  let dirs: string[]
  try {
    dirs = readdirSync(pluginsRoot)
      .filter(n => !n.startsWith('.'))
      .filter(n => {
        try { return statSync(join(pluginsRoot, n)).isDirectory() } catch { return false }
      })
  } catch {
    return [] // no plugins/ directory — nothing to validate
  }

  const seenNames = new Set<string>()
  for (const dir of dirs) {
    const manifestPath = join(pluginsRoot, dir, '.claude-plugin', 'plugin.json')
    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf8')
    } catch {
      errors.push({ plugin: dir, message: 'missing .claude-plugin/plugin.json' })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      errors.push({ plugin: dir, message: `invalid JSON — ${(e as Error).message}` })
      continue
    }
    const result = PluginManifestSchema.safeParse(parsed)
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ plugin: dir, message: `${issue.path.join('.') || '<root>'}: ${issue.message}` })
      }
      continue
    }
    if (seenNames.has(result.data.name)) {
      errors.push({ plugin: dir, message: `duplicate plugin name "${result.data.name}"` })
    }
    seenNames.add(result.data.name)
    if (result.data.name !== dir) {
      errors.push({ plugin: dir, message: `directory name does not match manifest name "${result.data.name}"` })
    }
  }
  return errors
}

const isMain = () => {
  if (typeof process === 'undefined' || !process.argv[1]) return false
  return fileURLToPath(import.meta.url) === process.argv[1]
}

/* v8 ignore start */
if (isMain()) {
  const errors = validateAll(process.cwd())
  if (errors.length === 0) {
    console.log('All plugin manifests are valid.')
    process.exit(0)
  }
  for (const e of errors) {
    console.error(`✗ plugins/${e.plugin}: ${e.message}`)
  }
  process.exit(1)
}
/* v8 ignore stop */
