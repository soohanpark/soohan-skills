/* v8 ignore start */
// 이 파일은 I/O 조립뿐이다 — 순수 로직(파싱, 분류, 키워드 추출, draft 케이스 구성,
// 증강 프롬프트 구성, 변형 부착)은 전부 ../mine.ts 에 있고 그쪽이 테스트 대상이다.
import { existsSync, mkdirSync, readdirSync, readFileSync as read, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EvalCase } from '../cases.js'
import {
  attachVariants, buildAugmentPrompt, classify, extractPrompts,
  keywordsFromDescription, mapLimit, mineConcurrency, parseVariants, toDraftCases
} from '../mine.js'
import { skillDescription } from '../judge.js'
import { parseClaudeStream } from '../parse.js'
import { evalsRoot, resolveSkill, skillMdExists, slug } from '../paths.js'
import { buildTextOnlyArgs, execClaude } from '../runtimes/claude.js'

const walkJsonl = (dir: string): string[] => {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkJsonl(p))
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

export const cmdMine = async (skillArg: string, repoRoot: string): Promise<void> => {
  const EVALS = evalsRoot(repoRoot)
  const skill = resolveSkill(skillArg, repoRoot)
  if (!skillMdExists(skill)) {
    console.error(`✗ ${skill.dir}/SKILL.md 가 없습니다 — "${skillArg}" 가 ${skill.id} 로 해석됐습니다.`)
    process.exit(1)
  }
  // 프론트매터 덩어리를 그대로 넘기면 name·allowed-tools·license 값까지 near-miss 판별
  // 키워드가 되어 무관한 프롬프트가 negative 로 뽑힌다 — judge 와 같은 추출기를 쓴다.
  const description = skillDescription(read(join(skill.dir, 'SKILL.md'), 'utf8'))
  const keywords = keywordsFromDescription(description)

  const sessionsRoot = join(homedir(), '.claude', 'projects')
  const files = existsSync(sessionsRoot) ? walkJsonl(sessionsRoot) : []
  const mined = files.flatMap(f => extractPrompts(read(f, 'utf8'), f.split('/').pop()!))

  const buckets = classify(mined, { skillId: skill.id, keywords })
  const originals = toDraftCases(buckets)

  // 표현 변형으로 물량을 채운다. 변형은 원본의 split 을 물려받으므로 누수가 없다 (설계 §6-3, §8-5)
  // 원본 1건당 CLI 를 한 번씩 부르므로 순차로 돌면 이 단계가 mine 전체 시간을 지배한다 —
  // 상한을 둔 채 동시에 돌린다. mapLimit 이 입력 순서를 지켜 draft 파일이 실행마다 흔들리지 않는다.
  const limit = mineConcurrency()
  if (originals.length > 0) {
    console.log(`원본 ${originals.length}건 증강 중 (동시 ${Math.min(limit, originals.length)}건)…`)
  }
  const augmented: EvalCase[] = (await mapLimit(originals, limit, async (c) => {
    try {
      const { stdout } = await execClaude(buildTextOnlyArgs(buildAugmentPrompt(c.prompt, 2)))
      const text = parseClaudeStream(stdout, { skillId: '', skillDir: '' }).finalText
      return attachVariants(c, parseVariants(text))
    } catch (e) {
      // 일시적 실패(네트워크/CLI) 하나로 이미 증강한 나머지 변형까지 버리지 않는다 — per-item try/catch.
      // 이 원본의 변형만 건너뛴다. mapLimit 은 던지면 전체를 거부하므로 여기서 반드시 잡는다.
      console.warn(`⚠ ${c.id}: 증강 실패 — ${(e as Error).message}`)
      return []
    }
  })).flat()

  const cases = [...originals, ...augmented]
  const outFile = join(EVALS, slug(skill.id), 'cases.draft.jsonl')
  mkdirSync(join(EVALS, slug(skill.id)), { recursive: true })
  writeFileSync(outFile, cases.map(c => JSON.stringify(c)).join('\n') + '\n')

  console.log(`세션 ${files.length}개 훑음 → positive ${buckets.positives.length}, near-miss ${buckets.nearMisses.length}, 변형 ${augmented.length}`)
  console.log(`→ ${outFile}`)
  console.log('⚠ 커밋 전 검토 필요 — 실사용 프롬프트 원문이 들어 있습니다. 확인 후 cases.jsonl 로 옮기세요.')
}
/* v8 ignore stop */
