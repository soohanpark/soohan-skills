import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncMarketplace } from '../scripts/sync'

let root: string

const writePlugin = (name: string, manifest: object) => {
  const dir = join(root, 'plugins', name, '.claude-plugin')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2))
}

const validManifest = (name: string) => ({
  name,
  version: '0.1.0',
  description: `${name} plugin`,
  author: { name: 'soohanpark' },
  category: 'meta',
  tags: ['test']
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'soohan-skills-'))
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  mkdirSync(join(root, 'plugins'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('syncMarketplace', () => {
  it('produces an empty plugins array when plugins/ is empty', () => {
    syncMarketplace(root)
    const out = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(out.plugins).toEqual([])
    expect(out.name).toBe('soohan-skills')
    expect(out.owner).toEqual({ name: 'soohanpark' })
  })

  it('lists discovered plugins sorted by name', () => {
    writePlugin('zeta', validManifest('zeta'))
    writePlugin('alpha', validManifest('alpha'))
    syncMarketplace(root)
    const out = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(out.plugins.map((p: any) => p.name)).toEqual(['alpha', 'zeta'])
  })

  it('propagates name, version, description, category, tags, and source path', () => {
    writePlugin('dry-skill', validManifest('dry-skill'))
    syncMarketplace(root)
    const out = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(out.plugins[0]).toMatchObject({
      name: 'dry-skill',
      source: './plugins/dry-skill',
      description: 'dry-skill plugin',
      version: '0.1.0',
      category: 'meta',
      tags: ['test']
    })
  })

  it('throws when a plugin directory has no plugin.json', () => {
    mkdirSync(join(root, 'plugins', 'broken'), { recursive: true })
    expect(() => syncMarketplace(root)).toThrow(/plugin\.json/)
  })

  it('throws when manifest is invalid', () => {
    writePlugin('bad', { ...validManifest('bad'), version: 'not-semver' })
    expect(() => syncMarketplace(root)).toThrow()
  })

  it('throws when directory name does not match manifest.name', () => {
    writePlugin('alpha', validManifest('beta'))
    expect(() => syncMarketplace(root)).toThrow(/directory.*name/i)
  })

  it('throws when two plugins declare the same name', () => {
    writePlugin('one', validManifest('one'))
    writePlugin('two', { ...validManifest('two'), name: 'one' })
    expect(() => syncMarketplace(root)).toThrow(/duplicate/i)
  })

  it('skips dotfiles and non-directory entries under plugins/', () => {
    writeFileSync(join(root, 'plugins', '.DS_Store'), '')
    writeFileSync(join(root, 'plugins', 'README.md'), '# x')
    syncMarketplace(root)
    const out = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(out.plugins).toEqual([])
  })

  it('is idempotent — two consecutive runs produce identical bytes', () => {
    writePlugin('alpha', validManifest('alpha'))
    syncMarketplace(root)
    const first = readFileSync(join(root, '.claude-plugin', 'marketplace.json'))
    syncMarketplace(root)
    const second = readFileSync(join(root, '.claude-plugin', 'marketplace.json'))
    expect(first.equals(second)).toBe(true)
  })

  it('output ends with a trailing newline and uses 2-space indentation', () => {
    writePlugin('alpha', validManifest('alpha'))
    syncMarketplace(root)
    const text = readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('  "name"')
  })

  it('returns an empty plugins array when plugins/ does not exist', () => {
    rmSync(join(root, 'plugins'), { recursive: true, force: true })
    syncMarketplace(root)
    const out = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
    expect(out.plugins).toEqual([])
  })

  it('creates .claude-plugin/ directory if it does not exist', () => {
    rmSync(join(root, '.claude-plugin'), { recursive: true, force: true })
    syncMarketplace(root)
    expect(() => readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')).not.toThrow()
  })
})
