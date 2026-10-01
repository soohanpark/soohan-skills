#!/usr/bin/env python3
"""Manage the Korean writing block in Codex's active global guidance."""

import argparse
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


START = "<!-- soohan-skills:korean-writing:start -->"
END = "<!-- soohan-skills:korean-writing:end -->"
SKILL_ROOT = Path(__file__).resolve().parents[1]


def active_guidance(home):
    override = home / "AGENTS.override.md"
    if override.exists() and override.read_text(encoding="utf-8").strip():
        return override
    return home / "AGENTS.md"


def managed_span(text):
    counts = (text.count(START), text.count(END))
    if counts == (0, 0):
        return None
    if counts != (1, 1):
        raise ValueError("관리 블록의 시작·끝 주석이 누락되거나 중복되어 있습니다.")
    start = text.index(START)
    end = text.index(END) + len(END)
    if end < start + len(START):
        raise ValueError("관리 블록의 주석 순서가 잘못되어 있습니다.")
    for marker in (START, END):
        position = text.index(marker)
        if position and text[position - 1] != "\n":
            raise ValueError("관리 블록 주석은 별도 줄에 있어야 합니다.")
        following = text[position + len(marker):]
        if following and not following.startswith(("\n", "\r\n")):
            raise ValueError("관리 블록 주석은 별도 줄에 있어야 합니다.")
    return start, end


def style_path(explicit):
    candidates = [Path(explicit).expanduser()] if explicit else [
        SKILL_ROOT.parent / "style" / "SKILL.md",
        SKILL_ROOT.parent / "korean-writing-style" / "SKILL.md",
    ]
    for candidate in candidates:
        if candidate.is_file():
            text = candidate.read_text(encoding="utf-8")
            frontmatter = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
            if frontmatter and re.search(
                r"^name:\s*['\"]?(?:style|korean-writing-style)['\"]?\s*$",
                frontmatter.group(1), re.M,
            ):
                return candidate.resolve()
    return None


def write_guidance(path, before, after):
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.exists()
    mode = stat.S_IMODE(path.stat().st_mode) if existed else 0o600
    current = path.read_bytes() if existed else b""
    if current != before:
        raise ValueError("읽은 뒤 전역 파일이 바뀌었습니다. 다시 실행하세요.")
    backup = None
    if existed:
        descriptor, name = tempfile.mkstemp(prefix=path.name + ".bak-", dir=path.parent)
        backup = Path(name)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(before)
        backup.chmod(mode)
    descriptor, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(after)
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return backup


def run(args):
    home = Path(args.codex_home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    home = home.expanduser().resolve()
    active = active_guidance(home)
    target = active.resolve()
    before = target.read_bytes() if target.exists() else b""
    text = before.decode("utf-8")
    span = managed_span(text)
    newline = "\r\n" if "\r\n" in text else "\n"
    template = (SKILL_ROOT / "assets" / "global-guidance.md").read_text(encoding="utf-8")
    block = template.rstrip("\n").replace("\n", newline)
    if managed_span(block) != (0, len(block)):
        raise ValueError("전역 지침 템플릿의 관리 주석이 잘못되어 있습니다.")
    print("활성 전역 지침:", active)
    if target != active:
        print("심링크 대상:", target)

    style = style_path(args.style_skill) if not args.remove else None
    if args.check:
        state = "미설정" if span is None else "이미 적용됨" if text[span[0]:span[1]] == block else "갱신 필요"
        print(state)
        print("문체 스킬:", style or "미설치")
        return 0 if state == "이미 적용됨" and style else 1
    if not args.remove and style is None:
        raise ValueError("문체 스킬이 없습니다. korean-writing을 먼저 설치하거나 --style-skill 경로를 지정하세요.")

    if args.remove:
        if span is None:
            print("이미 해제됨 — 변경 없음")
            return 0
        start, end = span
        if text[end:].startswith(newline):
            end += len(newline)
        updated = text[:start] + text[end:]
        action = "해제"
    elif span:
        updated = text[:span[0]] + block + text[span[1]:]
        action = "갱신"
    else:
        separator = "" if not text else newline if text.endswith("\n") else newline * 2
        updated = text + separator + block + newline
        action = "추가"

    after = updated.encode("utf-8")
    if before == after:
        print("이미 적용됨 — 변경 없음")
        return 0
    if args.dry_run:
        print("미리보기:", action, "(파일 변경 없음)")
        if not args.remove:
            print(block)
        return 0
    backup = write_guidance(target, before, after)
    print(action + " 완료")
    if backup:
        print("백업:", backup)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", help="Codex 프로필 디렉터리 (기본: CODEX_HOME 또는 ~/.codex)")
    parser.add_argument("--style-skill", help="같은 번들에서 발견되지 않을 때 문체 SKILL.md의 경로")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="설정과 문체 스킬을 확인하고 종료")
    mode.add_argument("--remove", action="store_true", help="이 스킬의 관리 블록만 제거")
    parser.add_argument("--dry-run", action="store_true", help="변경 예정 내용만 표시")
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, UnicodeError, ValueError) as error:
        print("설정 실패:", error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
