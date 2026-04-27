# Skill Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal Claude Code plugin marketplace at `soohan-skills` that auto-generates `marketplace.json` from `plugins/` and ships a seed `dry-skill` plugin.

**Architecture:** Single TypeScript repo. `scripts/sync.ts` walks `plugins/*/`, validates each `plugin.json` against a Zod schema, and writes `.claude-plugin/marketplace.json` (sorted, deterministic). A Husky pre-commit hook runs sync and auto-stages the manifest. A GitHub Actions workflow on `main` re-runs sync and fails on drift.

**Tech Stack:** Node 20+, TypeScript, tsx (no build step), Zod, Vitest, Husky, pnpm, GitHub Actions.

**Source spec:** `docs/superpowers/specs/2026-04-27-skill-marketplace-design.md`

---

## File Structure

```
soohan-skills/
├── .claude-plugin/marketplace.json       # generated; auto-staged by hook
├── plugins/
│   └── dry-skill/                        # seed plugin (Tasks 8-11)
│       ├── .claude-plugin/plugin.json
│       ├── skills/SKILL.md
│       ├── commands/dry-skill.md
│       └── README.md
├── scripts/
│   ├── schema.ts                         # Zod schemas (Task 2)
│   ├── sync.ts                           # core sync function + CLI entrypoint (Task 3)
│   └── validate.ts                       # standalone validator CLI (Task 4)
├── tests/
│   ├── schema.test.ts                    # Task 2
│   └── sync.test.ts                      # Task 3
├── .husky/pre-commit                     # Task 5
├── .github/workflows/verify.yml          # Task 6
├── docs/superpowers/                     # already exists
├── package.json                          # Task 1
├── tsconfig.json                         # Task 1
├── vitest.config.ts                      # Task 1
├── .gitignore                            # Task 1
└── README.md                             # Task 12
```

**Responsibility split:**

- `scripts/schema.ts` — single source of truth for the `plugin.json` Zod schema. Imported by `sync.ts` and `validate.ts`.
- `scripts/sync.ts` — pure function `syncMarketplace(rootDir): MarketplaceManifest` plus a thin CLI wrapper. Pure function makes testing trivial.
- `scripts/validate.ts` — CLI that walks `plugins/`, applies the schema, and prints human-readable errors. Zero filesystem mutation.
- Tests live in `tests/`, one file per script. Use Vitest's `tmpdir` for fixtures; never touch the real `plugins/` dir from tests.

---

## Task 1: Initialize Node project skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "soohan-skills",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "sync": "tsx scripts/sync.ts",
    "validate": "tsx scripts/validate.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "husky"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "husky": "^9.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["scripts/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['scripts/**/*.ts'],
      exclude: ['scripts/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
})
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.DS_Store
coverage/
*.log
.vitest-cache/
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: dependencies installed, `pnpm-lock.yaml` created.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: initialize node project skeleton"
```

---

## Task 2: Zod schema for `plugin.json` (TDD)

**Files:**
- Create: `tests/schema.test.ts`
- Create: `scripts/schema.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/schema.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/schema.test.ts`
Expected: FAIL — `Cannot find module '../scripts/schema'`.

- [ ] **Step 3: Implement schema**

Create `scripts/schema.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/schema.test.ts`
Expected: PASS — all schema tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/schema.ts tests/schema.test.ts
git commit -m "feat(schema): add zod schema for plugin manifests"
```

---

## Task 3: `sync` core function (TDD)

**Files:**
- Create: `tests/sync.test.ts`
- Create: `scripts/sync.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/sync.test.ts`:

```ts
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
    // Forced via filesystem-distinct dirs but a hand-edited manifest
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/sync.test.ts`
Expected: FAIL — `Cannot find module '../scripts/sync'`.

- [ ] **Step 3: Implement sync**

Create `scripts/sync.ts`:

```ts
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
  return readdirSync(pluginsRoot)
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
    if (manifest.name !== dir) {
      throw new Error(`plugins/${dir}: directory name does not match manifest name "${manifest.name}"`)
    }
    if (seenNames.has(manifest.name)) {
      throw new Error(`plugins/${dir}: duplicate plugin name "${manifest.name}"`)
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
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8')
  return out
}

const isMain = () => {
  if (typeof process === 'undefined' || !process.argv[1]) return false
  return fileURLToPath(import.meta.url) === process.argv[1]
}

if (isMain()) {
  try {
    syncMarketplace(process.cwd())
    console.log('marketplace.json synced')
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/sync.test.ts`
Expected: PASS — all sync tests green.

- [ ] **Step 5: Verify CLI works**

Run: `pnpm sync`
Expected: prints `marketplace.json synced` and creates/updates `.claude-plugin/marketplace.json` with `plugins: []` (no plugins yet — `plugins/` directory doesn't exist).

If `plugins/` doesn't exist, the script throws ENOENT. Create it as a sentinel:

```bash
mkdir -p plugins
touch plugins/.gitkeep
pnpm sync
```

Expected: `.claude-plugin/marketplace.json` exists with empty plugins array.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync.ts tests/sync.test.ts plugins/.gitkeep .claude-plugin/marketplace.json
git commit -m "feat(sync): generate marketplace.json from plugins directory"
```

---

## Task 4: Standalone `validate` CLI

**Files:**
- Create: `scripts/validate.ts`

- [ ] **Step 1: Implement validator**

Create `scripts/validate.ts`:

```ts
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
```

- [ ] **Step 2: Verify CLI works on the current state**

Run: `pnpm validate`
Expected: `All plugin manifests are valid.` (no plugins yet).

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.ts
git commit -m "feat(validate): add standalone manifest validator CLI"
```

---

## Task 5: Husky pre-commit hook

**Files:**
- Create: `.husky/pre-commit`

- [ ] **Step 1: Initialize Husky**

Run: `pnpm exec husky init`
Expected: creates `.husky/pre-commit` with a placeholder and adds the `prepare` script (already in package.json).

- [ ] **Step 2: Replace `.husky/pre-commit` content**

Overwrite `.husky/pre-commit` with:

```bash
pnpm sync && git add .claude-plugin/marketplace.json
```

- [ ] **Step 3: Make hook executable**

Run: `chmod +x .husky/pre-commit`
Expected: no output.

- [ ] **Step 4: Verify hook fires on commit**

Make a trivial change and commit:

```bash
echo "" >> .gitignore
git add .gitignore
git commit -m "chore: trigger pre-commit hook"
```

Expected: hook prints `marketplace.json synced` and the commit succeeds.

- [ ] **Step 5: Verify hook blocks commit on validation failure**

Temporarily create a broken plugin:

```bash
mkdir -p plugins/broken/.claude-plugin
echo '{"name": "broken"}' > plugins/broken/.claude-plugin/plugin.json
git add plugins/broken
git commit -m "test: should fail" || echo "commit blocked as expected"
```

Expected: commit fails with schema error. Clean up:

```bash
rm -rf plugins/broken
git restore --staged plugins/broken 2>/dev/null || true
```

- [ ] **Step 6: Commit hook config**

```bash
git add .husky/pre-commit
git commit -m "chore: add pre-commit hook to sync marketplace.json"
```

---

## Task 6: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/verify.yml`

- [ ] **Step 1: Create workflow**

Create `.github/workflows/verify.yml`:

```yaml
name: verify

on:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          run_install: false

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate plugin manifests
        run: pnpm validate

      - name: Run sync
        run: pnpm sync

      - name: Check marketplace.json is up to date
        run: git diff --exit-code .claude-plugin/marketplace.json

      - name: Run tests
        run: pnpm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/verify.yml
git commit -m "ci: verify marketplace.json + tests on main"
```

---

## Task 7: Seed `dry-skill` plugin manifest

**Files:**
- Create: `plugins/dry-skill/.claude-plugin/plugin.json`

- [ ] **Step 1: Remove the sentinel**

```bash
rm plugins/.gitkeep
```

- [ ] **Step 2: Create plugin manifest**

Create `plugins/dry-skill/.claude-plugin/plugin.json`:

```json
{
  "name": "dry-skill",
  "version": "0.1.0",
  "description": "Dry-run any skill with a flow diagram and simulated result",
  "author": { "name": "soohanpark" },
  "category": "meta",
  "tags": ["dry-run", "preview", "skill-introspection"]
}
```

- [ ] **Step 3: Run sync to verify pickup**

Run: `pnpm sync`
Expected: `marketplace.json synced`. The file `.claude-plugin/marketplace.json` now contains a single entry for `dry-skill`.

Verify by reading: `cat .claude-plugin/marketplace.json`
Expected: `plugins` array has one element with `"name": "dry-skill"`, `"source": "./plugins/dry-skill"`.

- [ ] **Step 4: Commit (pre-commit hook will re-sync)**

```bash
git add plugins/dry-skill
git commit -m "feat(dry-skill): add plugin manifest"
```

Expected: pre-commit re-runs sync (no-op) and the commit succeeds. `marketplace.json` is auto-staged if it changed.

---

## Task 8: `dry-skill` SKILL.md

**Files:**
- Create: `plugins/dry-skill/skills/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Create `plugins/dry-skill/skills/SKILL.md`:

```markdown
---
name: dry-skill
description: Use when the user wants to preview what a skill would do without producing real side effects. Activates explicitly via `/dry-skill <skill-name>` or implicitly when the user wraps a request in a dry-run intent (e.g. "dry run the brainstorming skill on this prompt").
---

# Dry-Skill

Preview what a skill would do, without running it for real. Useful for understanding skill behavior before committing to actual execution.

## Two Invocation Modes

| Mode | Form | Behavior |
|---|---|---|
| Explicit | `/dry-skill <skill-name>` | Dry-run the named skill |
| Trigger | `/dry-skill <natural language>` | Match the prompt to available skills, then dry-run them |

In Explicit mode, `<skill-name>` is either a bare name (`brainstorming`) or a plugin-qualified name (`superpowers:brainstorming`).

## Dry-Run Contract

You MUST:

1. Locate the target skill's definition. If the Skill tool has surfaced its content already, use that. Otherwise, find the skill's `SKILL.md` (e.g. via `Glob` over `~/.claude/plugins/**/SKILL.md` and `Read`) and read it.
2. Walk through the skill's instructions step by step in your head.
3. **NOT** call any side-effecting tool during the simulation:
   - `Write`, `Edit`, `NotebookEdit`
   - `Bash` commands that mutate state (anything other than read-only inspection)
   - The `Skill` tool itself (no real activation of the target skill — you are simulating it, not running it)
   - MCP tools that mutate external systems (anything that posts, sends, creates, updates, deletes)
4. You **MAY** call read-only tools when needed for accurate simulation:
   - `Read`, `Glob`, `Grep`
   - `Bash` for read-only inspection (`git status`, `git log`, `ls`, `cat` for files outside the project that can't be `Read`'d)
5. For every step the target skill would take, surface:
   - Which tool would be called
   - What arguments would be passed (summarized; full payloads only when material)
   - What the expected effect would be

If the target skill's logic cannot be simulated without side effects (e.g. it requires real network mutations to learn its next step), report this and stop. Do **not** fall back to running the skill for real.

## Trigger-Mode Skill Resolution

When invoked with a natural-language argument:

1. Parse the user's intent from the argument.
2. Match against the **available skills list exposed in the current Claude Code session** (the system reminder lists every skill the runtime advertises, with its description). This is the authoritative source — do **not** crawl the filesystem to discover skills.
3. Apply the superpowers priority rule: process skills (e.g. `brainstorming`, `debugging`) come before implementation skills (e.g. `frontend-design`, `mcp-builder`).
4. If 0 skills match, report this and stop. If ≥ 1 match, state the selected skill(s) and the matching rationale, then proceed.
5. If multiple skills would chain (e.g. brainstorming → writing-plans), simulate them in order. Combine their flows into a single diagram with a clear handoff marker.

## Output Format (fixed)

Always emit exactly this structure. Omit the "Files / state" section if nothing would have changed.

````
## Dry-run: <skill name(s)>

### Flow

```
<ASCII or mermaid diagram of the skill's steps>
```

### Step-by-step
1. [<skill>] <step description> — would call `<tool>(<args summary>)`
2. ...

### Simulated result
<What the skill would have produced. Be explicit that this is simulated, not real output.>

### Files / state that would have changed
- `<path>`: <preview of the intended change>
````

## What Dry-Skill is NOT

- Not a way to "test" a skill — there is no validation pass/fail. It only describes what would happen.
- Not a partial execution — either the simulation is fully side-effect-free, or you stop and report why.
- Not for skills the user has not granted access to. If the target skill is not in the available skills list, say so.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/dry-skill/skills/SKILL.md
git commit -m "feat(dry-skill): add SKILL.md with dry-run contract and output template"
```

---

## Task 9: `dry-skill` slash command

**Files:**
- Create: `plugins/dry-skill/commands/dry-skill.md`

- [ ] **Step 1: Create slash command**

Create `plugins/dry-skill/commands/dry-skill.md`:

```markdown
---
description: Dry-run a skill with a flow diagram and simulated result, no real side effects
---

The user invoked `/dry-skill $ARGUMENTS`.

Activate the `dry-skill` skill from this plugin (its SKILL.md describes the full contract) and follow it precisely.

Mode selection:
- If `$ARGUMENTS` is a single token that looks like a skill identifier — bare (`brainstorming`) or plugin-qualified (`superpowers:brainstorming`) — use **Explicit mode**: dry-run that named skill.
- Otherwise, treat `$ARGUMENTS` as a natural-language description of intent and use **Trigger mode**: match the description against the available skills list, then dry-run the selected skill(s).

Constraints:
- Do **not** call any side-effecting tool during simulation.
- Output must follow the fixed template defined in the dry-skill SKILL.md.
- If `$ARGUMENTS` is empty, ask the user which skill or intent to dry-run.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/dry-skill/commands/dry-skill.md
git commit -m "feat(dry-skill): add /dry-skill slash command"
```

---

## Task 10: `dry-skill` plugin README

**Files:**
- Create: `plugins/dry-skill/README.md`

- [ ] **Step 1: Create plugin README**

Create `plugins/dry-skill/README.md`:

```markdown
# dry-skill

Preview what a Claude Code skill would do without producing real side effects.

## Install

```
/plugin marketplace add soohanpark/soohan-skills
/plugin install dry-skill@soohan-skills
```

## Usage

**Explicit — dry-run a named skill:**
```
/dry-skill superpowers:brainstorming
```

**Trigger — describe intent in natural language:**
```
/dry-skill 브레인스토밍해줘
```

## What you get

A fixed-format report with:
- A flow diagram of the skill's steps
- A step-by-step list of the tools that would be called
- A simulated result (clearly marked as simulated)
- A preview of files or state that would have changed

## What dry-skill will not do

- Will not call `Write`, `Edit`, mutating `Bash`, the `Skill` tool, or MCP write/mutation tools during simulation
- Will not partially execute a skill — if it can't simulate without side effects, it stops and reports why
- Will not invent skills that aren't in the current session's available-skills list

## Author

soohanpark
```

- [ ] **Step 2: Commit**

```bash
git add plugins/dry-skill/README.md
git commit -m "docs(dry-skill): add plugin README"
```

---

## Task 11: Top-level repository README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:

```markdown
# soohan-skills

Personal Claude Code plugin marketplace. Curated, self-authored plugins.

## Use this marketplace

```
/plugin marketplace add soohanpark/soohan-skills
/plugin install <plugin-name>@soohan-skills
```

Browse available plugins in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) or under [`plugins/`](plugins/).

## Add a new plugin (maintainer)

1. Create a directory under `plugins/<name>/` with a kebab-case name.
2. Add `plugins/<name>/.claude-plugin/plugin.json` matching the schema in [`scripts/schema.ts`](scripts/schema.ts).
3. Add skill/command/agent files as needed.
4. `git commit` — the pre-commit hook regenerates `marketplace.json` and auto-stages it.

## Required `plugin.json` fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | kebab-case; must equal directory name |
| `version` | string | semver |
| `description` | string | non-empty |
| `author` | `{ name, email?, url? }` | |
| `category` | string | kebab-case |
| `tags` | `string[]` | ≥ 1 entry, kebab-case |
| `homepage` | string | optional, URL |
| `license` | string | optional, SPDX |

## Scripts

- `pnpm sync` — regenerate `marketplace.json` from `plugins/`
- `pnpm validate` — validate every `plugin.json` without writing anything
- `pnpm test` — run the test suite

## Layout

```
plugins/<name>/                          your plugin lives here
.claude-plugin/marketplace.json          generated; do not hand-edit
scripts/{schema,sync,validate}.ts        sync engine
.husky/pre-commit                        regenerates marketplace.json on commit
.github/workflows/verify.yml             CI on main
```

## Plugins

See `plugins/<name>/README.md` for each plugin's docs.

- [`dry-skill`](plugins/dry-skill/README.md) — dry-run any skill with a flow diagram
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add top-level README"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite with coverage**

Run: `pnpm test --coverage`
Expected: all tests pass; line/branch/function/statement coverage on `scripts/*.ts` ≥ 80% (vitest will fail the run otherwise).

- [ ] **Step 2: Run sync and confirm idempotency**

```bash
pnpm sync
git diff --exit-code .claude-plugin/marketplace.json
```
Expected: no diff. Manifest is stable.

- [ ] **Step 3: Run validate**

Run: `pnpm validate`
Expected: `All plugin manifests are valid.`

- [ ] **Step 4: Inspect generated manifest**

Read: `.claude-plugin/marketplace.json`
Expected:
- `name: "soohan-skills"`
- `owner: { name: "soohanpark" }`
- `plugins` array contains one entry: `dry-skill` with the metadata defined in Task 7

- [ ] **Step 5: Manually verify the directory tree matches the spec's Section 2**

Run: `ls -la && ls plugins/dry-skill && ls plugins/dry-skill/.claude-plugin`
Expected:
- Top level has `plugins/`, `scripts/`, `tests/`, `.claude-plugin/`, `.husky/`, `.github/`, `docs/`, `package.json`, etc.
- `plugins/dry-skill/` has `.claude-plugin/`, `skills/`, `commands/`, `README.md`
- `plugins/dry-skill/.claude-plugin/` has `plugin.json`

- [ ] **Step 6: Push to GitHub and verify CI**

(Maintainer step — only after the GitHub repo `soohanpark/soohan-skills` exists.)

```bash
git remote add origin git@github.com:soohanpark/soohan-skills.git
git push -u origin main
```

Expected: GitHub Actions `verify` workflow runs on `main` and passes.

- [ ] **Step 7: Smoke test the marketplace from a Claude Code session**

In a Claude Code session:
```
/plugin marketplace add soohanpark/soohan-skills
/plugin install dry-skill@soohan-skills
/dry-skill superpowers:brainstorming
```
Expected: dry-skill activates and produces output matching the fixed template in `plugins/dry-skill/skills/SKILL.md`.
