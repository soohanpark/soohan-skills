import { join } from 'node:path'
import type { SkillRef } from './runtimes/claude.js'

// "plugin:skill" 또는 SKILL.md 가 든 디렉터리 경로를 받는다.
export const resolveSkill = (arg: string, repoRoot: string): SkillRef => {
  if (arg.includes('/')) {
    const dir = arg.replace(/\/+$/, '')
    const parts = dir.split('/')
    return { id: `${parts.at(-3)}:${parts.at(-1)}`, dir }
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
