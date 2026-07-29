import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedSkillDir, resolveEvalHome, resolveSkill, skillMdExists, slug, runDirName } from '../../plugins/skill-eval/skills/score/scripts/paths'

// 격리 레코딩(--plugin-dir)은 SKILL.md 디렉터리가 아니라 .claude-plugin/plugin.json 이 있는
// 플러그인 루트를 CLI 에 넘겨야 한다 — 그래야 대상 플러그인만 명시 로드된다.
describe('resolveSkill · pluginRoot', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-root-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  const plant = (dir: string, name: string) => {
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
  }

  it('sets pluginRoot to the repo plugin directory for a plugin:skill id inside a checkout', () => {
    const plugin = join(root, 'plugins', 'demo')
    plant(plugin, 'demo')
    mkdirSync(join(plugin, 'skills', 'write'), { recursive: true })
    writeFileSync(join(plugin, 'skills', 'write', 'SKILL.md'), '# s')
    const r = resolveSkill('demo:write', root)
    expect(r.pluginRoot).toBe(plugin)
  })

  it('sets pluginRoot to the manifest directory for a marketplace-cache path', () => {
    const versionDir = join(root, 'cache', 'mp', 'demo', '1.0.0')
    plant(versionDir, 'demo')
    const dir = join(versionDir, 'skills', 'write')
    mkdirSync(dir, { recursive: true })
    const r = resolveSkill(dir, '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.pluginRoot).toBe(versionDir)
  })

  // 개인 스킬은 유저 스코프에 산다 — 로드할 플러그인이 없으므로 루트도 없어야 한다.
  it('leaves pluginRoot unset for a personal ~/.claude/skills skill', () => {
    const r = resolveSkill('/Users/x/Company/.claude/skills/voice-ko', '/repo')
    expect(r.pluginRoot).toBeUndefined()
  })

  it('leaves pluginRoot unset when no manifest exists on the way up', () => {
    const r = resolveSkill('/u/plugins/cache/official/dry-skill/1.2.0/skills/run', '/repo')
    expect(r.pluginRoot).toBeUndefined()
  })

  it('sets pluginRoot to the install path for an id resolved from the install records', () => {
    const installPath = join(root, 'cache', 'mp', 'demo', '2.0.0')
    plant(installPath, 'demo')
    mkdirSync(join(installPath, 'skills', 'write'), { recursive: true })
    writeFileSync(join(installPath, 'skills', 'write', 'SKILL.md'), '# s')
    const records = join(root, 'installed.json')
    writeFileSync(records, JSON.stringify({ plugins: { 'demo@mp': [{ installPath, scope: 'user' }] } }))
    const r = resolveSkill('demo:write', join(root, 'no-checkout'), { file: records, cwd: root })
    expect(r.dir).toBe(join(installPath, 'skills', 'write'))
    expect(r.pluginRoot).toBe(installPath)
  })
})
import { formatRecordSummary, buildRecordPlan, isQualityCase } from '../../plugins/skill-eval/skills/score/scripts/commands/record'

describe('resolveEvalHome', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-home-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('returns the checkout root when cwd is nested inside a soohan-skills clone', () => {
    writeFileSync(join(root, 'package.json'), '{"name":"soohan-skills"}')
    const nested = join(root, 'plugins', 'demo')
    mkdirSync(nested, { recursive: true })
    expect(resolveEvalHome(nested)).toBe(root)
  })

  it('falls back to ~/.skill-eval when no soohan-skills checkout is above cwd', () => {
    expect(resolveEvalHome(root)).toBe(join(homedir(), '.skill-eval'))
  })

  it('ignores unrelated package.json files on the way up', () => {
    writeFileSync(join(root, 'package.json'), '{"name":"other-project"}')
    expect(resolveEvalHome(root)).toBe(join(homedir(), '.skill-eval'))
  })

  it('skips a malformed package.json instead of crashing', () => {
    writeFileSync(join(root, 'package.json'), '{ not json')
    expect(resolveEvalHome(root)).toBe(join(homedir(), '.skill-eval'))
  })
})

describe('resolveSkill', () => {
  it('expands a plugin:skill id into the repository skill directory', () => {
    const r = resolveSkill('demo:write', '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.dir).toBe('/repo/plugins/demo/skills/write')
  })

  it('derives the id from a SKILL.md directory path', () => {
    const r = resolveSkill('/abs/plugins/demo/skills/write', '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.dir).toBe('/abs/plugins/demo/skills/write')
  })

  it('strips a trailing slash from a directory path', () => {
    expect(resolveSkill('/abs/plugins/demo/skills/write/', '/repo').dir)
      .toBe('/abs/plugins/demo/skills/write')
  })

  it('throws on an id without a colon', () => {
    expect(() => resolveSkill('demo', '/repo')).toThrow(/plugin:skill/)
  })

  it('accepts a path to the SKILL.md file itself', () => {
    const r = resolveSkill('/abs/plugins/demo/skills/write/SKILL.md', '/repo')
    expect(r.id).toBe('demo:write')
    expect(r.dir).toBe('/abs/plugins/demo/skills/write')
  })

  it('rejects a path without a <plugin>/skills/<skill> shape', () => {
    expect(() => resolveSkill('/somewhere/random-dir', '/repo')).toThrow(/skills/)
  })

  it('rejects a path whose plugin segment is a hidden directory like ~/.codex/skills/<name>', () => {
    expect(() => resolveSkill('/Users/x/.codex/skills/blin-mr', '/repo')).toThrow(/plugin/)
  })

  it('walks past a version segment in the marketplace cache layout', () => {
    const r = resolveSkill('/u/.claude/plugins/cache/official/dry-skill/1.2.0/skills/run', '/repo')
    expect(r.id).toBe('dry-skill:run')
  })

  // 개인/팀 로컬 스킬은 플러그인이 없는 것이 정상이고, 실제 id 는 접두사 없는 맨 이름이다.
  // 통째로 거부하면 ~/.claude/skills 아래 스킬은 측정 자체가 불가능해진다.
  it('gives a personal ~/.claude/skills/<name> skill its bare id', () => {
    const r = resolveSkill('/Users/x/Company/.claude/skills/voice-ko', '/repo')
    expect(r.id).toBe('voice-ko')
    expect(r.dir).toBe('/Users/x/Company/.claude/skills/voice-ko')
  })
})

// 경로에서 플러그인 이름을 "유추"하면 마켓플레이스가 버전 칸에 커밋 SHA 를 쓰는 순간 무너진다.
// 유령 id 는 예외도 안 던지므로 발동 판정(input.skill === skillId)이 항상 false 가 되어
// "발동률 0%" 가 조용히 나오고, description 탓으로 오독하게 된다 (외부 실측 보고 2026-07-28).
describe('resolveSkill · plugin.json 을 권위로 삼는다', () => {
  let root: string
  const plugin = (dir: string, name: string) => {
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }))
  }

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-paths-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('reads the plugin name from the manifest instead of the directory name', () => {
    const base = join(root, 'plugins', 'msu-arcade-skills')
    const skillDir = join(base, 'skills', 'migrate')
    mkdirSync(skillDir, { recursive: true })
    plugin(base, 'msuarcade')
    expect(resolveSkill(skillDir, '/repo').id).toBe('msuarcade:migrate')
  })

  it('resolves a commit-SHA cache layout that the version heuristic cannot detect', () => {
    const versioned = join(root, 'cache', 'msu-arcade-skills', 'msuarcade', 'fc030ea1e63b')
    const skillDir = join(versioned, 'skills', 'migrate')
    mkdirSync(skillDir, { recursive: true })
    plugin(versioned, 'msuarcade')
    expect(resolveSkill(skillDir, '/repo').id).toBe('msuarcade:migrate')
  })

  it('falls back to the path heuristic when there is no manifest', () => {
    const skillDir = join(root, 'demo', 'skills', 'write')
    mkdirSync(skillDir, { recursive: true })
    expect(resolveSkill(skillDir, '/repo').id).toBe('demo:write')
  })

  it('ignores a malformed manifest rather than crashing', () => {
    const base = join(root, 'demo')
    const skillDir = join(base, 'skills', 'write')
    mkdirSync(join(base, '.claude-plugin'), { recursive: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(base, '.claude-plugin', 'plugin.json'), '{ not json')
    expect(resolveSkill(skillDir, '/repo').id).toBe('demo:write')
  })
})

// 존재하지 않는 디렉터리를 가리키면 forced 변형이 존재하지 않는 슬래시 커맨드를 호출한다 —
// 그 변형은 턴 제한도 도구 제한도 없어서, 측정 대신 전권 도구로 프롬프트만 자유 실행된다.
describe('skillMdExists', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-skillmd-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('is true only when the resolved directory actually holds a SKILL.md', () => {
    const dir = join(root, 'demo', 'skills', 'write')
    mkdirSync(dir, { recursive: true })
    expect(skillMdExists({ id: 'demo:write', dir })).toBe(false)
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: write\n---\n')
    expect(skillMdExists({ id: 'demo:write', dir })).toBe(true)
  })

  it('is false for a directory that does not exist at all', () => {
    expect(skillMdExists({ id: 'demo:write', dir: join(root, 'nope') })).toBe(false)
  })
})

describe('slug', () => {
  it('turns a skill id into a directory-safe name', () => {
    expect(slug('demo:write')).toBe('demo.write')
  })
})

describe('runDirName', () => {
  it('combines a timestamp and the skill slug', () => {
    expect(runDirName('demo:write', new Date('2026-07-23T14:02:33Z')))
      .toBe('2026-07-23T14-02-33--demo.write')
  })

  it('is stable for the same instant', () => {
    const d = new Date('2026-07-23T14:02:33Z')
    expect(runDirName('a:b', d)).toBe(runDirName('a:b', d))
  })

  // 분 단위였을 때는 SKILL.md 를 고치고 60초 안에 다시 돌리면 직전 런 디렉터리를 그대로 재사용해
  // 한 번도 실행하지 않은 채 옛 스트림으로 index 를 재구성하고 meta 만 새 SHA 로 덮었다.
  it('separates two runs started in the same minute', () => {
    expect(runDirName('a:b', new Date('2026-07-23T14:02:03Z')))
      .not.toBe(runDirName('a:b', new Date('2026-07-23T14:02:47Z')))
  })
})

describe('formatRecordSummary', () => {
  it('reports counts and the run id', () => {
    const s = formatRecordSummary({ written: 10, skipped: 2, errorRate: 0 }, 'r1')
    expect(s).toContain('10건 실행')
    expect(s).toContain('2건 건너뜀')
    expect(s).toContain('r1')
  })

  it('warns when the error rate exceeds 20%', () => {
    expect(formatRecordSummary({ written: 10, skipped: 0, errorRate: 0.3 }, 'r1'))
      .toContain('신뢰할 수 없습니다')
  })

  it('does not warn at or below 20%', () => {
    expect(formatRecordSummary({ written: 10, skipped: 0, errorRate: 0.2 }, 'r1'))
      .not.toContain('신뢰할 수 없습니다')
  })
})

describe('isQualityCase', () => {
  it('returns true for a case with must array', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, must: ['a'] }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns true for a case with must_not array', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, must_not: ['a'] }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns true for a case with qualitative: true', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const, qualitative: true }
    expect(isQualityCase(c)).toBe(true)
  })

  it('returns false for a pure trigger case with no quality flags', () => {
    const c = { id: '1', prompt: 'test', expect: 'trigger' as const, split: 'train' as const }
    expect(isQualityCase(c)).toBe(false)
  })
})

describe('buildRecordPlan', () => {
  it('creates only "with" variants for pure trigger cases (3 repeats each)', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const }
    ]
    const plan = buildRecordPlan(cases)
    const c1Items = plan.filter(item => item.caseId === 'c1')
    expect(c1Items).toHaveLength(3)
    expect(c1Items.every(item => item.variant === 'with')).toBe(true)
    expect(c1Items.map(item => item.repeat).sort()).toEqual([1, 2, 3])
  })

  it('creates "with", "forced", and "without" variants for quality cases (with repeated 3x, others 1x)', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const, must: ['x'] }
    ]
    const plan = buildRecordPlan(cases)
    const withItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'with')
    const forcedItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'forced')
    const withoutItems = plan.filter(item => item.caseId === 'c1' && item.variant === 'without')
    expect(withItems).toHaveLength(3)
    expect(forcedItems).toHaveLength(1)
    expect(withoutItems).toHaveLength(1)
  })

  it('handles a case with only qualitative: true as a quality case', () => {
    const cases = [
      { id: 'c1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const, qualitative: true }
    ]
    const plan = buildRecordPlan(cases)
    const variants = new Set(plan.map(item => item.variant))
    expect(variants).toEqual(new Set(['with', 'forced', 'without']))
  })

  it('partitions mixed input correctly: trigger + quality', () => {
    const cases = [
      { id: 'trigger1', prompt: 'test1', expect: 'trigger' as const, split: 'train' as const },
      { id: 'quality1', prompt: 'test2', expect: 'trigger' as const, split: 'train' as const, must_not: ['y'] }
    ]
    const plan = buildRecordPlan(cases)

    // Trigger case should have only "with" (3x)
    const trigger1Items = plan.filter(item => item.caseId === 'trigger1')
    expect(trigger1Items).toHaveLength(3)
    expect(trigger1Items.every(item => item.variant === 'with')).toBe(true)

    // Quality case should have "with" (3x), "forced" (1x), "without" (1x)
    const quality1Items = plan.filter(item => item.caseId === 'quality1')
    expect(quality1Items).toHaveLength(5)

    // All case IDs must be present and no duplication
    const allCaseIds = plan.map(item => item.caseId)
    expect(new Set(allCaseIds)).toEqual(new Set(['trigger1', 'quality1']))
  })

  it('does not drop or double-count cases', () => {
    const cases = [
      { id: 'a', prompt: 'pa', expect: 'trigger' as const, split: 'train' as const },
      { id: 'b', prompt: 'pb', expect: 'trigger' as const, split: 'train' as const, must: ['x'] },
      { id: 'c', prompt: 'pc', expect: 'trigger' as const, split: 'train' as const }
    ]
    const plan = buildRecordPlan(cases)
    const caseIds = new Set(plan.map(item => item.caseId))
    expect(caseIds).toEqual(new Set(['a', 'b', 'c']))

    // a and c should each have exactly 3 items (trigger cases)
    expect(plan.filter(item => item.caseId === 'a')).toHaveLength(3)
    expect(plan.filter(item => item.caseId === 'c')).toHaveLength(3)
    // b should have 5 items (3 with + 1 forced + 1 without)
    expect(plan.filter(item => item.caseId === 'b')).toHaveLength(5)
  })
})

// 설치본을 쓰는 사람에게 plugin:skill id 는 사실상 쓸 수 없는 형식이었다 — eval 홈 아래
// <홈>/plugins/<plugin>/skills/<skill> 만 찾아서 늘 빈 경로가 나왔다. 설치 경로는
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ 이고 버전이 디렉터리 이름이라
// 재설치할 때마다 바뀐다 — 사람이 외워 넘기면 계속 어긋난다. 설치 기록에서 찾아준다.
describe('installedSkillDir', () => {
  let root: string
  const write = (plugins: Record<string, unknown>) => {
    const f = join(root, 'installed_plugins.json')
    writeFileSync(f, JSON.stringify({ plugins }))
    return f
  }
  const installed = (version: string, over: Record<string, unknown> = {}) => {
    const p = join(root, 'cache', 'mk', 'msuarcade', version, 'skills', 'init')
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'SKILL.md'), '---\nname: init\n---\n')
    return { installPath: join(root, 'cache', 'mk', 'msuarcade', version), version, ...over }
  }

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-installed-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('finds the installed skill directory from the plugin id', () => {
    const f = write({ 'msuarcade@msu-arcade-skills': [installed('0.0.10')] })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/anywhere' }))
      .toBe(join(root, 'cache', 'mk', 'msuarcade', '0.0.10', 'skills', 'init'))
  })

  // 세션이 실제로 읽는 사본은 이 프로젝트에 설치된 것이다 — 그것을 재야 측정이 성립한다.
  it('prefers the copy installed for the current project over any other', () => {
    const f = write({
      'msuarcade@mk': [
        installed('0.0.6', { projectPath: '/proj/other' }),
        installed('0.0.10', { projectPath: '/proj/here' })
      ]
    })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/proj/here' }))
      .toContain('0.0.10')
  })

  it('matches a subdirectory of the installed project path', () => {
    const f = write({ 'msuarcade@mk': [installed('0.0.6', { projectPath: '/proj/other' }), installed('0.0.10', { projectPath: '/proj/here' })] })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/proj/here/sub/dir' })).toContain('0.0.10')
  })

  it('falls back to a user-scope install when no project matches', () => {
    const f = write({
      'msuarcade@mk': [
        installed('0.0.6', { projectPath: '/proj/other' }),
        installed('0.0.9', { scope: 'user' })
      ]
    })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/somewhere/else' })).toContain('0.0.9')
  })

  it('falls back to the most recently updated install as a last resort', () => {
    const f = write({
      'msuarcade@mk': [
        installed('0.0.6', { projectPath: '/a', lastUpdated: '2026-01-01T00:00:00Z' }),
        installed('0.0.9', { projectPath: '/b', lastUpdated: '2026-07-29T00:00:00Z' })
      ]
    })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/nope' })).toContain('0.0.9')
  })

  it('ignores a different plugin whose name merely starts the same way', () => {
    const f = write({ 'msuarcade-extra@mk': [installed('0.0.10')] })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/x' })).toBeNull()
  })

  it('returns null when the recorded install no longer holds that skill', () => {
    const f = write({ 'msuarcade@mk': [{ installPath: join(root, 'gone'), version: '0.0.1' }] })
    expect(installedSkillDir('msuarcade', 'init', { file: f, cwd: '/x' })).toBeNull()
  })

  it('returns null rather than crashing on a missing or malformed record file', () => {
    expect(installedSkillDir('msuarcade', 'init', { file: join(root, 'nope.json'), cwd: '/x' })).toBeNull()
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{ not json')
    expect(installedSkillDir('msuarcade', 'init', { file: broken, cwd: '/x' })).toBeNull()
  })
})

describe('resolveSkill · 설치본 id 해석', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'eval-resolve-installed-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  const record = (version: string) => {
    const dir = join(root, 'cache', 'mk', 'msuarcade', version, 'skills', 'init')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: init\n---\n')
    const f = join(root, 'installed.json')
    writeFileSync(f, JSON.stringify({ plugins: { 'msuarcade@mk': [{ installPath: join(root, 'cache', 'mk', 'msuarcade', version), version }] } }))
    return f
  }

  it('resolves an id to the installed copy when the eval home has no such skill', () => {
    const f = record('0.0.10')
    const r = resolveSkill('msuarcade:init', join(root, 'evalhome'), { file: f, cwd: '/x' })
    expect(r.id).toBe('msuarcade:init')
    expect(r.dir).toContain(join('msuarcade', '0.0.10', 'skills', 'init'))
    expect(skillMdExists(r)).toBe(true)
  })

  // 체크아웃 안에서 재는 경우 레포 사본이 우선이다 — 기존 동작을 바꾸지 않는다.
  it('still prefers the checkout copy when one exists', () => {
    const f = record('0.0.10')
    const repo = join(root, 'evalhome', 'plugins', 'msuarcade', 'skills', 'init')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'SKILL.md'), '---\nname: init\n---\n')
    expect(resolveSkill('msuarcade:init', join(root, 'evalhome'), { file: f, cwd: '/x' }).dir).toBe(repo)
  })

  it('falls back to the eval-home path when nothing is installed either', () => {
    const r = resolveSkill('msuarcade:init', join(root, 'evalhome'), { file: join(root, 'none.json'), cwd: '/x' })
    expect(r.dir).toBe(join(root, 'evalhome', 'plugins', 'msuarcade', 'skills', 'init'))
    expect(skillMdExists(r)).toBe(false)
  })
})
