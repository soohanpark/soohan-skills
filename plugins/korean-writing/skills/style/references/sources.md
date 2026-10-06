# 출처와 적용 범위

## im-not-ai

- 저장소: https://github.com/epoko77-ai/im-not-ai
- 검토한 커밋: `2f3d943d08056b612a92e12bfb72ea94dd2acd18`
- 문체 규칙: https://github.com/epoko77-ai/im-not-ai/blob/2f3d943d08056b612a92e12bfb72ea94dd2acd18/skills/humanize-korean/references/quick-rules.md
- Codex 실행 계약: https://github.com/epoko77-ai/im-not-ai/blob/2f3d943d08056b612a92e12bfb72ea94dd2acd18/codex/skills/humanize-korean/SKILL.md
- 라이선스: MIT, Copyright (c) 2026 epoko77-ai. 고지는 [upstream-license.txt](upstream-license.txt)에 보관한다.

원본은 번역투, 영어 용어, 구조와 서식, 상투구, 리듬, 수식과 중복, 완곡 표현, 접속사,
의존명사, 시각 장식을 문맥과 장르에 따라 진단하고 교정한다. 사실·직접 인용·격식·서법을
보존하고, 좋은 글을 과하게 고치지 않는 원칙이 핵심이다.

`style/SKILL.md`는 이 원칙들을 한국어를 처음 작성할 때와 요약할 때도 적용하도록 새로
정리한 문체 지침이다. 원본의 85개 패턴을 전부 구현한 탐지기가 아니며, AI 작성 여부나
탐지 회피를 판정하지 않는다.

원본의 패턴별 빈도 임계값·등급·변경률 게이트·다중 에이전트·결과 파일 생성은 포함하지
않는다. 이를 전역 답변마다 적용하면 문서를 지나치게 고치거나 불필요한 실행 절차를
만들 수 있기 때문이다. 정밀 윤문은 원본 스킬을 별도로 설치해 명시적으로 요청할 수 있다.

## Codex 설정

- 전역 지침과 override: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- 스킬의 명시·자동 호출: https://learn.chatgpt.com/docs/build-skills

스킬을 설치하면 사용할 수 있게 되지만 본문이 매번 로드되지는 않는다. setup은 사용자가
명시적으로 지정하거나 한국어 문체 개선이 작업에 필요하다고 판단할 때만 사용하도록 전역
지침에 조건을 추가한다. 한국어로 답변한다는 이유만으로 호출하지 않는다.
설치 경로나 플러그인 캐시 버전은 기록하지 않아 업데이트 후에도
해당 환경에 표시된 스킬 이름으로 발견할 수 있게 한다.
