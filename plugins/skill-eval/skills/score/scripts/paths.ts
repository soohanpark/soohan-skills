import { join } from 'node:path'
import type { SkillRef } from './runtimes/claude.js'

// "plugin:skill", SKILL.md 가 든 디렉터리 경로, 또는 SKILL.md 파일 경로 자체를 받는다.
export const resolveSkill = (arg: string, repoRoot: string): SkillRef => {
  if (arg.includes('/')) {
    const dir = arg.replace(/\/+$/, '').replace(/\/SKILL\.md$/, '')
    const parts = dir.split('/')
    const [rawPlugin, skills, skill] = [parts.at(-3), parts.at(-2), parts.at(-1)]
    // 마켓플레이스 캐시 레이아웃(<plugin>/<version>/skills/<name>)은 버전 한 칸 위가 플러그인이다
    const plugin = /^\d+\.\d+/.test(rawPlugin ?? '') ? parts.at(-4) : rawPlugin
    // 모양 검증 없이는 ~/.codex/skills/x 가 ".codex:x" 같은 유령 id 를 만든다 (리뷰 R11)
    if (skills !== 'skills' || !plugin || plugin.startsWith('.')) {
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

export const slug = (id: string): string => id.replace(':', '.')

export const runDirName = (skillId: string, at: Date): string =>
  `${at.toISOString().replace(/:/g, '-').slice(0, 16)}--${slug(skillId)}`

export const evalsRoot = (repoRoot: string): string => join(repoRoot, 'evals')
export const casesFile = (repoRoot: string, skillId: string): string =>
  join(evalsRoot(repoRoot), slug(skillId), 'cases.jsonl')
export const runDir = (repoRoot: string, runId: string): string =>
  join(evalsRoot(repoRoot), 'runs', runId)
