/* v8 ignore start */
// 이 파일은 I/O 조립뿐이다 — 순수 로직(기준 도출, 프롬프트 구성, 응답 파싱, 편향 통제,
// 집계)은 전부 ../judge.ts 에 있고 그쪽이 테스트 대상이다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases } from '../cases.js'
import {
  buildJudgePrompt, deriveCriteria, isJudgeTrustworthy, isRationaleOnTopic,
  parseVerdict, resolvePair, scorePairwise, type PairResult, type Verdict
} from '../judge.js'
import { parseClaudeStream } from '../parse.js'
import { casesFile, evalsRoot, resolveSkill, runDir } from '../paths.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { execClaude } from '../runtimes/claude.js'

const askJudge = async (criteria: string, a: string, b: string): Promise<{ verdict: Verdict; rationale: string }> => {
  const prompt = buildJudgePrompt({ criteria, a, b })
  const { stdout } = await execClaude(['-p', prompt, '--output-format', 'stream-json', '--verbose'])
  const parsed = parseClaudeStream(stdout, { skillId: '', skillDir: '' })
  return parseVerdict(parsed.finalText)
}

export const cmdJudge = async (runId: string, repoRoot: string): Promise<void> => {
  const EVALS = evalsRoot(repoRoot)
  const dir = runDir(repoRoot, runId)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as RunMeta
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]
  const cases = loadCases(casesFile(repoRoot, meta.skillId))
  const skill = resolveSkill(meta.skillId, repoRoot)
  const description = readFileSync(join(skill.dir, 'SKILL.md'), 'utf8').split('---')[1] ?? ''

  const results: PairResult[] = []

  for (const c of cases.filter(c => c.qualitative)) {
    const forced = index.find(e => e.variant === 'forced' && e.caseId === c.id)
    const without = index.find(e => e.variant === 'without' && e.caseId === c.id)
    if (!forced || !without || forced.parsed.status !== 'ok' || without.parsed.status !== 'ok') continue
    if (without.parsed.skillReadFallback) {
      console.warn(`⚠ ${c.id}: baseline 이 SKILL.md 를 직접 읽었습니다. 이 쌍은 제외합니다.`)
      continue
    }

    const criteria = deriveCriteria(c, description.trim())
    try {
      // 1회차: forced=A, 2회차: 순서를 뒤집어 forced=B
      const first = await askJudge(criteria, forced.parsed.finalText, without.parsed.finalText)
      const flipped = await askJudge(criteria, without.parsed.finalText, forced.parsed.finalText)

      const offTopic = !isRationaleOnTopic(first.rationale, criteria) || !isRationaleOnTopic(flipped.rationale, criteria)
      results.push({
        caseId: c.id,
        split: c.split,
        outcome: resolvePair(first.verdict, flipped.verdict),
        discarded: offTopic
      })
    } catch (e) {
      // 일시적 실패(네트워크/CLI) 하나로 이미 판정한 나머지 쌍까지 버리지 않는다 — recordAll과 동일한
      // per-item try/catch. scorePairwise가 discarded 를 모든 집계에서 제외하므로 이 쌍만 빠진다.
      console.warn(`⚠ ${c.id}: 판정 실패 — ${(e as Error).message}`)
      results.push({ caseId: c.id, split: c.split, outcome: 'tie', discarded: true })
    }
  }

  // A=A sanity check — 동일 출력을 양쪽에 넣었을 때 무승부가 아니면 이 심판은 못 믿는다 (설계 §7-2)
  const sample = index.find(e => e.variant === 'forced' && e.parsed.status === 'ok')
  let judgeTrustworthy = true
  if (sample) {
    try {
      const sanity = await askJudge('출력이 기준을 충족하는가', sample.parsed.finalText, sample.parsed.finalText)
      judgeTrustworthy = isJudgeTrustworthy(sanity)
      if (!judgeTrustworthy) console.error('⚠ 심판 신뢰성 실패 — 동일 출력에 우열을 매겼습니다. 정성 판정 결과를 신뢰하지 마세요.')
    } catch (e) {
      // 자가진단 자체가 실패하면 검증할 방법이 없다 — 신뢰할 수 있다고 가정하지 않는다.
      judgeTrustworthy = false
      console.warn(`⚠ 심판 신뢰성 자가진단 실패 — ${(e as Error).message}. 정성 판정 결과를 신뢰하지 마세요.`)
    }
  }

  const verdictFile = join(EVALS, 'verdicts', `${runId}.json`)
  mkdirSync(join(EVALS, 'verdicts'), { recursive: true })
  writeFileSync(verdictFile, JSON.stringify({
    runId, judgeModel: 'claude', judgeTrustworthy, results, score: scorePairwise(results)
  }, null, 2))

  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, judgeModel: 'claude' }, null, 2))

  console.log(`판정 완료: ${results.length}쌍 → ${verdictFile}`)
}
/* v8 ignore stop */
