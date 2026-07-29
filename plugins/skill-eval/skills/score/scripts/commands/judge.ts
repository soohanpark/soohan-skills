/* v8 ignore start */
// 이 파일은 I/O 조립뿐이다 — 순수 로직(기준 도출, 프롬프트 구성, 응답 파싱, 편향 통제,
// 집계)은 전부 ../judge.ts 에 있고 그쪽이 테스트 대상이다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { casesDrifted, hashCases, loadCases } from '../cases.js'
import {
  buildJudgeArgs, buildJudgePrompt, deriveCriteria, isJudgeTrustworthy, isRationaleOnTopic,
  parseVerdict, resolvePair, scorePairwise, skillDescription,
  type JudgeCheck, type PairResult, type Verdict
} from '../judge.js'
import { parseClaudeStream } from '../parse.js'
import { casesFile, evalsRoot, resolveSkill, runDir } from '../paths.js'
import { forcedUsable } from '../score.js'
import type { IndexEntry, RunMeta } from '../record.js'
import { execClaude } from '../runtimes/claude.js'

const askJudge = async (criteria: string, a: string, b: string): Promise<{ verdict: Verdict; rationale: string; model: string; costUsd: number }> => {
  const prompt = buildJudgePrompt({ criteria, a, b })
  const { stdout } = await execClaude(buildJudgeArgs(prompt))
  const parsed = parseClaudeStream(stdout, { skillId: '', skillDir: '' })
  return { ...parseVerdict(parsed.finalText), model: parsed.model, costUsd: parsed.costUsd }
}

export const cmdJudge = async (runId: string, repoRoot: string): Promise<void> => {
  const EVALS = evalsRoot(repoRoot)
  const dir = runDir(repoRoot, runId)
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as RunMeta
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as IndexEntry[]
  const cases = loadCases(casesFile(repoRoot, meta.skillId))
  if (casesDrifted(meta.casesHash, hashCases(cases))) {
    console.warn('⚠ 케이스 파일이 이 실행을 기록한 시점과 다릅니다 — 지금의 cases.jsonl 로 옛 실행을 판정합니다.')
  }
  // skillDir 는 이 필드가 생기기 전 실행에는 없다 — 레포 안 스킬이라면 id 로 복원할 수 있다.
  const skillDir = meta.skillDir ?? resolveSkill(meta.skillId, repoRoot).dir
  const description = skillDescription(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'))
  if (description === '') {
    console.error(`✗ ${skillDir}/SKILL.md 에서 description 을 읽지 못했습니다 — 판정 기준을 세울 수 없습니다.`)
    process.exit(1)
  }

  // 실제 심판 모델은 첫 응답 스트림에서 나온다 — §8-3의 "심판 모델 기록"은 CLI 이름이 아니라 이 값이다.
  let judgeModel: string | null = null
  let judgeCostUsd = 0
  const ask = async (criteria: string, a: string, b: string) => {
    const r = await askJudge(criteria, a, b)
    judgeModel = judgeModel ?? (r.model || null)
    judgeCostUsd += r.costUsd
    return r
  }

  const results: PairResult[] = []

  // 제외한 쌍도 결과에 남긴다. 그냥 continue 하면 승률 분모가 조용히 줄어, 다섯 쌍 중 하나만
  // 비교하고도 '100%' 가 찍힌다 — 폐기 건수로 남아야 리포트와 판정이 그 축소를 볼 수 있다.
  const skip = (c: { id: string; split: 'train' | 'test' }, why: string) => {
    console.warn(`⚠ ${c.id}: ${why}. 이 쌍은 제외합니다.`)
    results.push({ caseId: c.id, split: c.split, outcome: 'tie', discarded: true })
  }

  for (const c of cases.filter(c => c.qualitative)) {
    const forced = index.find(e => e.variant === 'forced' && e.caseId === c.id)
    const without = index.find(e => e.variant === 'without' && e.caseId === c.id)
    if (!forced) { skip(c, 'forced 실행 기록이 없습니다'); continue }
    if (!without) { skip(c, 'baseline(without) 실행 기록이 없습니다'); continue }
    if (without.parsed.status !== 'ok') { skip(c, `baseline: ${without.parsed.terminalReason}`); continue }
    // forced 가 잘렸거나 스킬이 붙지 않았으면 비교 대상이 아니다 — 스킬 없이 낸 답을
    // 스킬 편에 세우면 페어와이즈가 스킬이 아니라 모델을 재게 된다.
    const usable = forcedUsable(forced)
    if (!usable.usable) { skip(c, usable.detail); continue }
    const baselineDenials = without.parsed.permissionDenials ?? []
    if (baselineDenials.length > 0) {
      skip(c, `baseline 이 권한 거부로 도구를 못 썼습니다 (${[...new Set(baselineDenials)].join(', ')})`)
      continue
    }
    if (without.parsed.truncated) { skip(c, 'baseline 이 턴 한도에 걸려 잘렸습니다'); continue }
    if (without.parsed.skillReadFallback) { skip(c, 'baseline 이 SKILL.md 를 직접 읽었습니다'); continue }

    const criteria = deriveCriteria(c, description)
    try {
      // 1회차: forced=A, 2회차: 순서를 뒤집어 forced=B
      const first = await ask(criteria, forced.parsed.finalText, without.parsed.finalText)
      const flipped = await ask(criteria, without.parsed.finalText, forced.parsed.finalText)

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

  // A=A sanity check — 동일 출력을 양쪽에 넣었을 때 무승부가 아니면 이 심판은 못 믿는다 (설계 §7-2).
  // 검사에 쓸 샘플이 없으면 'unchecked' 다. 예전에는 초기값 true 가 그대로 기록돼, 검사를 한 번도
  // 안 돌린 실행이 '신뢰함'으로 저장됐다.
  const sample = index.find(e => e.variant === 'forced' && forcedUsable(e).usable)
  let judgeCheck: JudgeCheck = 'unchecked'
  if (sample) {
    try {
      const sanity = await ask('출력이 기준을 충족하는가', sample.parsed.finalText, sample.parsed.finalText)
      judgeCheck = isJudgeTrustworthy(sanity) ? 'trusted' : 'untrusted'
      if (judgeCheck === 'untrusted') console.error('⚠ 심판 신뢰성 실패 — 동일 출력에 우열을 매겼습니다. 정성 판정 결과를 신뢰하지 마세요.')
    } catch (e) {
      // 자가진단 자체가 실패하면 검증할 방법이 없다 — 신뢰할 수 있다고 가정하지 않는다.
      judgeCheck = 'untrusted'
      console.warn(`⚠ 심판 신뢰성 자가진단 실패 — ${(e as Error).message}. 정성 판정 결과를 신뢰하지 마세요.`)
    }
  } else {
    console.warn('⚠ 심판 자가진단 미수행 — 검사에 쓸 forced 실행이 없습니다. 정성 축은 판정 불가로 남습니다.')
  }

  const verdictFile = join(EVALS, 'verdicts', `${runId}.json`)
  mkdirSync(join(EVALS, 'verdicts'), { recursive: true })
  writeFileSync(verdictFile, JSON.stringify({
    runId, judgeModel: judgeModel ?? 'claude', judgeCheck, costUsd: judgeCostUsd,
    results, score: scorePairwise(results)
  }, null, 2))

  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, judgeModel: judgeModel ?? 'claude' }, null, 2))

  console.log(`판정 완료: ${results.length}쌍 · 심판 자가진단 ${judgeCheck} · $${judgeCostUsd.toFixed(2)} → ${verdictFile}`)
}
/* v8 ignore stop */
