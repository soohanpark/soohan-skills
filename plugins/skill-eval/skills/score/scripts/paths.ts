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
// 매니페스트는 플러그인 루트에 있으므로 네 단계면 닿는다.
const MANIFEST_SEARCH_DEPTH = 4

const pluginNameFromManifest = (skillDir: string): string | null => {
  let dir = skillDir
  for (let up = 0; up < MANIFEST_SEARCH_DEPTH; up++) {
    const manifest = join(dir, '.claude-plugin', 'plugin.json')
    if (existsSync(manifest)) {
      try {
        const name = JSON.parse(readFileSync(manifest, 'utf8')).name
        if (typeof name === 'string' && name !== '') return name
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

// 개인·팀 로컬 스킬이 사는 곳. 여기엔 플러그인이 없는 것이 정상이고, 스킬의 실제 id 는
// 접두사 없는 맨 이름이다. 다른 CLI 의 설치 루트(.codex 등)는 계속 거부한다 — 그쪽에 설치된
// 사본을 claude 런타임으로 재면 세션에 없는 스킬을 재는 셈이라 측정이 성립하지 않는다.
const PERSONAL_SKILL_ROOT = '.claude'

// "plugin:skill", SKILL.md 가 든 디렉터리 경로, 또는 SKILL.md 파일 경로 자체를 받는다.
export const resolveSkill = (arg: string, repoRoot: string): SkillRef => {
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
    const fromManifest = pluginNameFromManifest(dir)
    if (fromManifest) return { id: `${fromManifest}:${skill}`, dir }

    if (rawPlugin === PERSONAL_SKILL_ROOT) return { id: skill, dir }

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
  return { id: arg, dir: join(repoRoot, 'plugins', plugin, 'skills', skill) }
}

// 해석된 경로가 실제 스킬을 가리키는지. 아니면 forced 변형이 존재하지 않는 슬래시 커맨드를
// 호출하는데, 그 변형은 --max-turns 도 --disallowedTools 도 없어서 측정 대신 전권 도구로
// 프롬프트만 자유 실행된다 — 조용히 틀린 id 가 가장 비싸게 새는 지점이다.
export const skillMdExists = (skill: SkillRef): boolean =>
  existsSync(join(skill.dir, 'SKILL.md'))

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
