import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginManifestSchema, type PluginManifest } from './schema.js'

interface MarketplaceEntry {
  name: string
  source: string
  description: string
  version: string
  category: string
  tags: string[]
}

interface MarketplaceManifest {
  name: string
  owner: { name: string }
  plugins: MarketplaceEntry[]
}

const MARKETPLACE_NAME = 'soohan-skills'
const OWNER = { name: 'soohanpark' }

const readManifest = (pluginDir: string, dirName: string): PluginManifest => {
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json')
  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch {
    throw new Error(`plugins/${dirName}: missing .claude-plugin/plugin.json`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`plugins/${dirName}: invalid JSON in plugin.json — ${(e as Error).message}`)
  }
  const result = PluginManifestSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`plugins/${dirName}: schema violation — ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  return result.data
}

const listPluginDirs = (root: string): string[] => {
  const pluginsRoot = join(root, 'plugins')
  let entries: string[]
  try {
    entries = readdirSync(pluginsRoot)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  return entries
    .filter(name => !name.startsWith('.'))
    .filter(name => {
      try {
        return statSync(join(pluginsRoot, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

const toEntry = (manifest: PluginManifest, dirName: string): MarketplaceEntry => ({
  name: manifest.name,
  source: `./plugins/${dirName}`,
  description: manifest.description,
  version: manifest.version,
  category: manifest.category,
  tags: [...manifest.tags]
})

export const syncMarketplace = (root: string): MarketplaceManifest => {
  const dirs = listPluginDirs(root)
  const entries: MarketplaceEntry[] = []
  const seenNames = new Set<string>()

  for (const dir of dirs) {
    const manifest = readManifest(join(root, 'plugins', dir), dir)
    // Duplicate check runs before the directory/name match so the test that
    // asserts "duplicate" semantics can fire predictably; if both invariants
    // are violated, "duplicate" wins.
    if (seenNames.has(manifest.name)) {
      throw new Error(`plugins/${dir}: duplicate plugin name "${manifest.name}"`)
    }
    if (manifest.name !== dir) {
      throw new Error(`plugins/${dir}: directory name does not match manifest name "${manifest.name}"`)
    }
    seenNames.add(manifest.name)
    entries.push(toEntry(manifest, dir))
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const out: MarketplaceManifest = {
    name: MARKETPLACE_NAME,
    owner: OWNER,
    plugins: entries
  }

  const outPath = join(root, '.claude-plugin', 'marketplace.json')
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8')
  return out
}

const isMain = () => {
  if (typeof process === 'undefined' || !process.argv[1]) return false
  return fileURLToPath(import.meta.url) === process.argv[1]
}

/* v8 ignore start */
if (isMain()) {
  try {
    syncMarketplace(process.cwd())
    console.log('marketplace.json synced')
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
/* v8 ignore stop */
