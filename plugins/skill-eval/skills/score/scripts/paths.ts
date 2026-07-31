import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillRef } from './runtimes/claude.js'

// soohan-skills 체크아웃 안에서 돌면 그 루트(evals/ 가 커밋 대상), 밖에서 돌면
// ~/.skill-eval — 설치된 플러그인만으로 아무 프로젝트에서나 쓰기 위한 분기다.
export const resolveEvalHome = (cwd: string): string => {
  let dir = cwd
  while (true) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).name === 'soohan-skills') return dir
      } catch {
        // 깨진 package.json 은 지나치고 계속 올라간다
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return join(homedir(), '.skill-eval')
    dir = parent
  }
}

// 스킬 디렉터리에서 위로 올라가며 플러그인 매니페스트를 찾는다. 플러그인 이름의 권위 있는
// 출처는 이 파일 하나뿐이다 — <plugin>/skills/<skill> 이든 <plugin>/<version>/skills/<skill> 이든
// 매니페스트는 플러그인 루트에 있으므로 네 단계면 닿는다. 격리 레코딩(--plugin-dir)이
// 그 루트 경로도 쓰므로 이름과 함께 돌려준다.
const MANIFEST_SEARCH_DEPTH = 4

const findPluginManifest = (skillDir: string): { root: string; name: string } | null => {
  let dir = skillDir
  for (let up = 0; up < MANIFEST_SEARCH_DEPTH; up++) {
    const manifest = join(dir, '.claude-plugin', 'plugin.json')
    if (existsSync(manifest)) {
      try {
        const name = JSON.parse(readFileSync(manifest, 'utf8')).name
        if (typeof name === 'string' && name !== '') return { root: dir, name }
      } catch {
        // 깨진 매니페스트는 없는 것으로 보고 경로 휴리스틱으로 넘어간다
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// 설치된 플러그인은 ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ 에 놓이고
// 그 경로가 installed_plugins.json 에 기록된다. 버전이 디렉터리 이름이라 재설치할 때마다
// 경로가 바뀌므로, 사람이 경로를 외워 넘기면 매번 어긋난다 — 그래서 id 를 넘겼을 때 여기서 찾는다.
// 이게 없으면 plugin:skill 형식은 레포 체크아웃 안에서만 쓸 수 있는 반쪽짜리 인자였다.
export interface InstalledLookup {
  file?: string   // 테스트 주입용. 기본은 Claude Code 의 설치 기록.
  cwd?: string
}

interface InstallRecord {
  installPath?: unknown
  projectPath?: unknown
  scope?: unknown
  lastUpdated?: unknown
}

const installRecordsFile = (opts: InstalledLookup): string =>
  opts.file ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json')

export const installedSkillDir = (
  plugin: string,
  skill: string,
  opts: InstalledLookup = {}
): string | null => {
  const file = installRecordsFile(opts)
  if (!existsSync(file)) return null

  let records: InstallRecord[]
  try {
    const plugins = JSON.parse(readFileSync(file, 'utf8'))?.plugins ?? {}
    // 키는 "<plugin>@<marketplace>" 다. '@' 앞이 정확히 일치해야 한다 —
    // startsWith 로 보면 msuarcade 가 msuarcade-extra 까지 집는다.
    records = Object.entries(plugins as Record<string, unknown>)
      .filter(([key]) => key.split('@')[0] === plugin)
      .flatMap(([, entries]) => (Array.isArray(entries) ? entries : []) as InstallRecord[])
      .filter(e => typeof e?.installPath === 'string')
  } catch {
    return null   // 기록 파일이 깨졌으면 없는 것으로 본다
  }
  if (records.length === 0) return null

  const cwd = opts.cwd ?? process.cwd()
  const inProject = (e: InstallRecord): boolean =>
    typeof e.projectPath === 'string' && (cwd === e.projectPath || cwd.startsWith(e.projectPath + '/'))

  // 세션이 실제로 읽는 사본을 골라야 측정이 성립한다: 이 프로젝트 것 → user 스코프 → 최신 갱신
  const picked =
    records.find(inProject) ??
    records.find(e => e.scope === 'user') ??
    [...records].sort((a, b) =>
      String(b.lastUpdated ?? '').localeCompare(String(a.lastUpdated ?? '')))[0]

  const dir = join(String(picked.installPath), 'skills', skill)
  // 기록은 남아 있는데 디렉터리가 지워진 경우가 흔하다 — 실재할 때만 돌려준다.
  return existsSync(join(dir, 'SKILL.md')) ? dir : null
}

// 개인·팀 로컬 스킬이 사는 곳. 여기엔 플러그인이 없는 것이 정상이고, 스킬의 실제 id 는
// 접두사 없는 맨 이름이다. 다른 CLI 의 설치 루트(.codex 등)는 계속 거부한다 — 그쪽에 설치된
// 사본을 claude 런타임으로 재면 세션에 없는 스킬을 재는 셈이라 측정이 성립하지 않는다.
const PERSONAL_SKILL_ROOT = '.claude'

// "plugin:skill", SKILL.md 가 든 디렉터리 경로, 또는 SKILL.md 파일 경로 자체를 받는다.
export const resolveSkill = (arg: string, repoRoot: string, opts: InstalledLookup = {}): SkillRef => {
  if (arg.includes('/')) {
    const dir = arg.replace(/\/+$/, '').replace(/\/SKILL\.md$/, '')
    const parts = dir.split('/')
    const [rawPlugin, skills, skill] = [parts.at(-3), parts.at(-2), parts.at(-1)]
    if (skills !== 'skills' || !skill) {
      throw new Error(`"${arg}" 에서 plugin 이름을 찾을 수 없습니다 — <plugin>/skills/<skill> 모양의 경로가 필요합니다.`)
    }

    // 매니페스트를 먼저 본다. 경로 모양으로 유추하면 마켓플레이스가 버전 칸에 커밋 SHA 를 쓰는
    // 순간(예: <plugin>/fc030ea1e63b/skills/<skill>) "fc030ea1e63b:migrate" 같은 유령 id 가 나온다.
    // 모양 검증은 통과하므로 예외도 안 나고, 발동 판정이 항상 false 가 되어 발동률 0% 가 조용히
    // 찍힌다 — description 탓으로 오독하기 쉽다 (외부 실측 보고 2026-07-28).
    // 개인 스킬 판정이 먼저다. 매니페스트 탐색은 위로 올라가므로, 레포 안의
    // <repo>/.claude/skills/<name> 이 레포 루트의 plugin.json 을 집어 유령 접두사를 달 수 있다.
    if (rawPlugin === PERSONAL_SKILL_ROOT) return { id: skill, dir }

    const manifest = findPluginManifest(dir)
    if (manifest) return { id: `${manifest.name}:${skill}`, dir, pluginRoot: manifest.root }

    // 매니페스트가 없는 설치본용 폴백 — 마켓플레이스 캐시 레이아웃은 버전 한 칸 위가 플러그인이다
    const plugin = /^\d+\.\d+/.test(rawPlugin ?? '') ? parts.at(-4) : rawPlugin
    // 모양 검증 없이는 ~/.codex/skills/x 가 ".codex:x" 같은 유령 id 를 만든다 (리뷰 R11)
    if (!plugin || plugin.startsWith('.')) {
      throw new Error(`"${arg}" 에서 plugin 이름을 찾을 수 없습니다 — <plugin>/skills/<skill> 모양의 경로가 필요합니다.`)
    }
    return { id: `${plugin}:${skill}`, dir }
  }
  if (!arg.includes(':')) {
    throw new Error(`"${arg}" 는 plugin:skill 형식이 아닙니다. 경로를 주려면 슬래시를 포함하세요.`)
  }
  const [plugin, skill] = arg.split(':')
  // 체크아웃 안이면 레포 사본이 우선이다 — 지금 고치는 중인 그 파일을 재는 것이 맞다.
  // pluginRoot 도 같은 사본에서 찾는다 — 격리 실행이 로드하는 플러그인과 judge 가 읽는
  // SKILL.md 가 같은 트리여야 측정과 판정이 같은 대상을 본다.
  const inRepo = join(repoRoot, 'plugins', plugin, 'skills', skill)
  if (existsSync(join(inRepo, 'SKILL.md'))) return { id: arg, dir: inRepo, pluginRoot: findPluginManifest(inRepo)?.root }

  const installed = installedSkillDir(plugin, skill, opts)
  if (installed) return { id: arg, dir: installed, pluginRoot: findPluginManifest(installed)?.root }

  // 둘 다 없으면 원래 경로를 그대로 돌려준다 — CLI 계층의 skillMdExists 가 사람이 읽을
  // 메시지로 잡는다. 여기서 던지면 판정 문구가 두 군데로 갈린다.
  return { id: arg, dir: inRepo }
}

// 해석된 경로가 실제 스킬을 가리키는지. 아니면 forced 변형이 존재하지 않는 슬래시 커맨드를
// 호출하는데, 그 변형은 --max-turns 도 --disallowedTools 도 없어서 측정 대신 전권 도구로
// 프롬프트만 자유 실행된다 — 조용히 틀린 id 가 가장 비싸게 새는 지점이다.
export const skillMdExists = (skill: SkillRef): boolean =>
  existsSync(join(skill.dir, 'SKILL.md'))

// 훅을 가진 플러그인의 트리거 축은 description 단독이 아니라 "플러그인 전체(훅 포함) 발동률"
// 이다 — 실측(2026-07-30, superpowers)에서 자체 SessionStart 훅이 발동을 밀어붙였다. 리포트가
// 그 사실을 라벨할 수 있게 기록 시점에 감지해 meta 에 남긴다.
export const pluginShipsHooks = (pluginRoot: string): boolean =>
  existsSync(join(pluginRoot, 'hooks', 'hooks.json'))

export const slug = (id: string): string => id.replace(':', '.')

// 초까지 넣는다. 분 단위였을 때는 SKILL.md 를 고치고 60초 안에 다시 돌리면 디렉터리가 겹쳐
// 모든 항목이 existsSync 로 건너뛰어졌다 — 새 코드로는 한 번도 실행하지 않은 채 옛 스트림으로
// index 를 재구성하고 meta 만 새 repoSha 로 덮어, "이 커밋에서 측정한 결과"라고 잘못 라벨된
// 옛 측정치가 만들어진다.
export const runDirName = (skillId: string, at: Date): string =>
  `${at.toISOString().replace(/:/g, '-').slice(0, 19)}--${slug(skillId)}`

export const evalsRoot = (repoRoot: string): string => join(repoRoot, 'evals')
export const casesFile = (repoRoot: string, skillId: string): string =>
  join(evalsRoot(repoRoot), slug(skillId), 'cases.jsonl')
export const runDir = (repoRoot: string, runId: string): string =>
  join(evalsRoot(repoRoot), 'runs', runId)
