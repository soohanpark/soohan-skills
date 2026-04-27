import { describe, it, expect } from 'vitest'
import { PluginManifestSchema } from '../scripts/schema'

const valid = {
  name: 'dry-skill',
  version: '0.1.0',
  description: 'Dry-run any skill',
  author: { name: 'soohanpark' },
  category: 'meta',
  tags: ['dry-run', 'preview']
}

describe('PluginManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(() => PluginManifestSchema.parse(valid)).not.toThrow()
  })

  it('rejects missing name', () => {
    const bad = { ...valid, name: undefined }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects non-kebab-case name', () => {
    const bad = { ...valid, name: 'DryRun' }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects bad semver', () => {
    const bad = { ...valid, version: '1' }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('accepts pre-release semver', () => {
    const ok = { ...valid, version: '0.1.0-beta.1' }
    expect(() => PluginManifestSchema.parse(ok)).not.toThrow()
  })

  it('rejects empty description', () => {
    const bad = { ...valid, description: '' }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects missing author.name', () => {
    const bad = { ...valid, author: {} }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects empty tags array', () => {
    const bad = { ...valid, tags: [] }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects non-kebab-case category', () => {
    const bad = { ...valid, category: 'Meta Tools' }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('rejects non-kebab-case tag', () => {
    const bad = { ...valid, tags: ['Dry Run'] }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })

  it('accepts optional homepage and license', () => {
    const ok = { ...valid, homepage: 'https://example.com', license: 'MIT' }
    expect(() => PluginManifestSchema.parse(ok)).not.toThrow()
  })

  it('rejects invalid homepage URL', () => {
    const bad = { ...valid, homepage: 'not a url' }
    expect(() => PluginManifestSchema.parse(bad)).toThrow()
  })
})
