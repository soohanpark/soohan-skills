# korean-writing

한국어 문체를 여러 기기에서 같은 원본으로 관리한다. `style`은 작성·수정·요약에 적용할 문체
규칙이고, `setup`은 Codex 전역 지침에 그 스킬의 사용 조건을 설정한다.

| 스킬 | 하는 일 |
|---|---|
| `korean-writing:style` | 의미·어조를 보존하며 번역투·상투구·기계적인 반복을 줄인다 |
| `korean-writing:setup` | Codex 전역 지침에 적용 조건을 추가·갱신·확인·해제한다 |

`style`은 사용자가 명시적으로 지정하거나 한국어 문체 개선이 작업에 필요하다고 판단할 때만
사용한다. 한국어로 답변한다는 이유만으로 매번 읽거나 적용하지 않는다.

문체 원칙은 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)의 한국어 윤문 지침을 일상적인
작성에도 적용하도록 재구성했다. 원본의 정밀 진단·변경률 검사·파일 생성 절차는 포함하지
않는다. 출처와 범위는 [sources.md](skills/style/references/sources.md)에 있다.

## Codex에서 설치하고 설정하기

로컬 체크아웃에서 실행한다.

```bash
./install.sh --target "${CODEX_HOME:-$HOME/.codex}/skills"
```

새 세션에서 다음처럼 요청한다.

```text
$korean-writing-setup 한국어 문체 스킬을 Codex 전역 지침에 적용해줘.
```

자연어로 "한국어 글쓰기 전역 지침 설정해줘"라고 요청해도 된다. 설치 스크립트는 두 스킬을
`korean-writing-style`, `korean-writing-setup`이라는 이름으로 설치한다. 스킬 설치 자체는
전역 지침을 바꾸지 않는다. 설정은 새 Codex 세션부터 반영된다. 명시적으로 문체 스킬을
사용하려면 다음처럼 요청한다.

```text
$korean-writing-style 이 문서의 번역투와 반복 표현을 다듬어줘.
```

setup은 `CODEX_HOME` 또는 `~/.codex`의 `AGENTS.md`를 사용한다. 비어 있지 않은
`AGENTS.override.md`가 있으면 그 활성 파일에 반영한다. 기존 내용과 심링크를 보존하고,
변경이 있을 때만 백업을 남긴다. 관리 블록에 버전별 절대 경로는 넣지 않는다.

## 다른 기기와 업데이트

이 변경이 저장소에 반영된 뒤 다른 기기에서 저장소를 갱신하고 설치 명령을 실행한다.
각 기기에서 setup을 한 번 실행하면 된다. 설치된 복사본은 기기 간에 자동 동기화되지 않으므로
업데이트할 때는 설치 명령을 다시 실행한다. 전역 적용 조건도 바뀌었다면 setup도 다시 실행한다.

한국어 문체 개선이 필요하면 style을 적용한다. 블로그 글의 자료 수집·구성은 `document:writing-post`가
담당하며, 이 스킬이 그 절차를 대신하지 않는다.

## 상태 확인과 해제

```text
$korean-writing-setup 한국어 문체 전역 설정 상태를 확인해줘.
$korean-writing-setup 한국어 문체 전역 적용을 해제해줘.
```

설치된 스크립트를 직접 사용할 수도 있다. Python 3.8 이상이 필요하다.

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/korean-writing-setup/scripts/setup_global.py" --dry-run
python3 "${CODEX_HOME:-$HOME/.codex}/skills/korean-writing-setup/scripts/setup_global.py" --check
python3 "${CODEX_HOME:-$HOME/.codex}/skills/korean-writing-setup/scripts/setup_global.py" --remove
```

다른 위치에 style만 설치되어 있으면 `--style-skill /path/to/SKILL.md`로 지정한다. 해제는
이 플러그인의 관리 블록만 제거하며 문체 스킬이나 다른 지침은 삭제하지 않는다.

## Claude Code에서 문체 스킬 사용

```text
/plugin install korean-writing@soohan-skills
/reload-plugins
```

설치된 `korean-writing:style`을 요청할 수 있다. setup 스크립트의 전역 설정 대상은 Codex다.
Gemini·Kimi에서도 설치된 문체 스킬을 사용할 수 있지만, 각 도구의 전역 지침 파일을 이
스크립트가 자동 설정하지는 않는다.

## 검증

```bash
pnpm test:korean-writing
```

임시 홈에서 실제 설치와 설정, 반복 실행·갱신·해제, override, `CODEX_HOME`, 심링크,
미리보기, 미설치와 손상된 블록의 처리를 검증한다. 실제 사용자의 전역 설정은 건드리지 않는다.
