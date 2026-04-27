import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateAll } from '../scripts/validate'

let root: string

const writePlugin = (name: string, manifest: object | string) => {
  const dir = join(root, 'plugins', name, '.claude-plugin')
  mkdirSync(dir, { recursive: true })
  const content = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2)
  writeFileSync(join(dir, 'plugin.json'), content)
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
  root = mkdtempSync(join(tmpdir(), 'soohan-skills-validate-'))
  mkdirSync(join(root, 'plugins'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('validateAll', () => {
  it('returns [] when plugins/ is empty', () => {
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('returns [] when plugins/ directory is missing', () => {
    rmSync(join(root, 'plugins'), { recursive: true, force: true })
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('returns [] for a single valid plugin', () => {
    writePlugin('my-plugin', validManifest('my-plugin'))
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('returns [] for multiple valid plugins', () => {
    writePlugin('alpha', validManifest('alpha'))
    writePlugin('beta', validManifest('beta'))
    writePlugin('gamma', validManifest('gamma'))
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('reports missing .claude-plugin/plugin.json', () => {
    mkdirSync(join(root, 'plugins', 'no-manifest'), { recursive: true })
    const errors = validateAll(root)
    expect(errors).toHaveLength(1)
    expect(errors[0].plugin).toBe('no-manifest')
    expect(errors[0].message).toMatch(/missing .claude-plugin\/plugin\.json/)
  })

  it('reports invalid JSON', () => {
    writePlugin('broken-json', '{ "name": "broken-json" ')
    const errors = validateAll(root)
    expect(errors).toHaveLength(1)
    expect(errors[0].plugin).toBe('broken-json')
    expect(errors[0].message).toMatch(/invalid JSON/)
  })

  it('reports schema violations with field paths and messages', () => {
    writePlugin('bad-schema', {
      name: 'bad-schema',
      version: 'not-semver',
      description: 'test',
      author: { name: 'soohanpark' },
      category: 'INVALID_CATEGORY',
      tags: ['test']
    })
    const errors = validateAll(root)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    const plugins = errors.map(e => e.plugin)
    expect(plugins.every(p => p === 'bad-schema')).toBe(true)
    // Should report version and category issues
    const messages = errors.map(e => e.message)
    expect(messages.some(m => m.includes('version'))).toBe(true)
    expect(messages.some(m => m.includes('category'))).toBe(true)
  })

  it('reports directory/name mismatch', () => {
    writePlugin('dir-name', { ...validManifest('different-name') })
    const errors = validateAll(root)
    expect(errors).toHaveLength(1)
    expect(errors[0].plugin).toBe('dir-name')
    expect(errors[0].message).toMatch(/directory name does not match manifest name/)
  })

  it('only reports errors for invalid plugins when mixed with valid ones', () => {
    writePlugin('valid-one', validManifest('valid-one'))
    writePlugin('invalid-one', '{ "name": "invalid-one" ')
    writePlugin('valid-two', validManifest('valid-two'))
    const errors = validateAll(root)
    expect(errors).toHaveLength(1)
    expect(errors[0].plugin).toBe('invalid-one')
  })

  it('skips dotfiles in plugins/', () => {
    writeFileSync(join(root, 'plugins', '.DS_Store'), '')
    writePlugin('real-plugin', validManifest('real-plugin'))
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('skips non-directory entries in plugins/', () => {
    writeFileSync(join(root, 'plugins', 'README.md'), '# x')
    writePlugin('real-plugin', validManifest('real-plugin'))
    const errors = validateAll(root)
    expect(errors).toEqual([])
  })

  it('reports duplicate plugin names across directories', () => {
    writePlugin('one', validManifest('one'))
    // dir 'two' but manifest.name 'one' — produces both a duplicate error and a dir/name mismatch error
    writePlugin('two', { ...validManifest('two'), name: 'one' })
    const errors = validateAll(root)
    const messages = errors.map(e => e.message).join('\n')
    expect(messages).toMatch(/duplicate plugin name "one"/)
  })
})
