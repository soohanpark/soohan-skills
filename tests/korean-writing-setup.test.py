"""Exercise the installed setup against isolated Codex profiles."""

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "plugins" / "korean-writing" / "skills"
START = b"<!-- soohan-skills:korean-writing:start -->"
END = b"<!-- soohan-skills:korean-writing:end -->"


class KoreanWritingSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="korean-writing-test-")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.codex = self.home / ".codex"
        self.installed = self.codex / "skills"
        shutil.copytree(SKILLS / "setup", self.installed / "korean-writing-setup")
        shutil.copytree(SKILLS / "style", self.installed / "korean-writing-style")
        self.script = self.installed / "korean-writing-setup" / "scripts" / "setup_global.py"
        self.guidance = self.codex / "AGENTS.md"
        self.environment = dict(os.environ, HOME=str(self.home), PYTHONDONTWRITEBYTECODE="1")
        self.environment.pop("CODEX_HOME", None)

    def invoke(self, *arguments, expected=0, script=None, environment=None):
        result = subprocess.run(
            [sys.executable, str(script or self.script), *arguments],
            env=environment or self.environment, cwd=self.home,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def backups(self, guidance=None):
        path = guidance or self.guidance
        return sorted(path.parent.glob(path.name + ".bak-*"))

    def test_create_and_check_without_backup(self):
        self.invoke()
        text = self.guidance.read_bytes()
        self.assertEqual(text.count(START), 1)
        self.assertEqual(text.count(END), 1)
        self.assertIn(b"korean-writing-style", text)
        self.assertEqual(self.backups(), [])
        self.invoke("--check")

    def test_preserve_original_bytes_permissions_and_backup(self):
        original = "# 내 지침\r\n\r\n- 사용자가 요청할 때만 커밋한다.".encode("utf-8")
        self.guidance.write_bytes(original)
        self.guidance.chmod(0o640)
        self.invoke()
        changed = self.guidance.read_bytes()
        self.assertTrue(changed.startswith(original))
        self.assertNotIn(b"\n", changed.replace(b"\r\n", b""))
        self.assertEqual(stat.S_IMODE(self.guidance.stat().st_mode), 0o640)
        self.assertEqual(len(self.backups()), 1)
        self.assertEqual(self.backups()[0].read_bytes(), original)

    def test_repeat_is_noop_and_update_replaces_only_owned_block(self):
        original = "# 다른 규칙\n- 응답은 짧게 쓴다.\n".encode("utf-8")
        self.guidance.write_bytes(original)
        self.invoke()
        configured = self.guidance.read_bytes()
        modified_at = self.guidance.stat().st_mtime_ns
        self.invoke()
        self.assertEqual(self.guidance.read_bytes(), configured)
        self.assertEqual(self.guidance.stat().st_mtime_ns, modified_at)
        self.assertEqual(len(self.backups()), 1)

        suffix = "\n# 나중에 추가한 지침\n- 표는 비교할 때 사용한다.\n".encode("utf-8")
        self.guidance.write_bytes(configured + suffix)
        template = self.script.parent.parent / "assets" / "global-guidance.md"
        template.write_text(template.read_text().replace("## 한국어 작성", "## 한국어 작성 문체"))
        self.invoke("--check", expected=1)
        self.invoke()
        updated = self.guidance.read_bytes()
        self.assertTrue(updated.startswith(original))
        self.assertTrue(updated.endswith(suffix))
        self.assertEqual(updated.count(START), 1)
        self.assertIn("## 한국어 작성 문체".encode("utf-8"), updated)
        self.assertEqual(len(self.backups()), 2)
        self.assertIn(configured + suffix, [p.read_bytes() for p in self.backups()])
        self.invoke("--check")

    def test_remove_preserves_other_instructions_and_is_idempotent(self):
        original = "# 기존 설정\n- 사실을 확인한다.\n".encode("utf-8")
        self.guidance.write_bytes(original)
        self.invoke()
        suffix = "\n# 새 규칙\n- 인용을 보존한다.\n".encode("utf-8")
        self.guidance.write_bytes(self.guidance.read_bytes() + suffix)
        configured = self.guidance.read_bytes()
        shutil.rmtree(self.installed / "korean-writing-style")
        self.invoke("--remove")
        removed = self.guidance.read_bytes()
        self.assertTrue(removed.startswith(original))
        self.assertTrue(removed.endswith(suffix))
        self.assertNotIn(START, removed)
        self.assertNotIn(b"korean-writing-style", removed)
        self.assertIn(configured, [p.read_bytes() for p in self.backups()])
        self.invoke("--remove")
        self.assertEqual(self.guidance.read_bytes(), removed)
        self.assertEqual(len(self.backups()), 2)

    def test_preview_and_check_do_not_write(self):
        self.invoke("--check", expected=1)
        preview = self.invoke("--dry-run")
        self.assertIn("파일 변경 없음", preview.stdout)
        self.assertFalse(self.guidance.exists())
        self.assertEqual(self.backups(), [])
        self.invoke()
        configured = self.guidance.read_bytes()
        self.invoke("--remove", "--dry-run")
        self.assertEqual(self.guidance.read_bytes(), configured)
        self.assertEqual(self.backups(), [])

    def test_nonempty_override_is_the_only_modified_file(self):
        original = b"# Base guidance\n"
        self.guidance.write_bytes(original)
        override = self.codex / "AGENTS.override.md"
        existing = b"# Active override\n"
        override.write_bytes(existing)
        self.invoke()
        self.assertEqual(self.guidance.read_bytes(), original)
        self.assertTrue(override.read_bytes().startswith(existing))
        self.assertIn(START, override.read_bytes())
        self.assertEqual(self.backups(), [])
        self.assertEqual(self.backups(override)[0].read_bytes(), existing)
        self.invoke("--check")

    def test_empty_override_falls_back_to_base(self):
        override = self.codex / "AGENTS.override.md"
        override.write_text("\n \t\n")
        self.invoke()
        self.assertIn(START, self.guidance.read_bytes())
        self.assertEqual(override.read_text(), "\n \t\n")

    def test_codex_home_and_explicit_profile_override(self):
        profile = self.home / "separate profile"
        environment = dict(self.environment, CODEX_HOME=str(profile))
        self.invoke(environment=environment)
        self.assertIn(START, (profile / "AGENTS.md").read_bytes())
        self.assertFalse(self.guidance.exists())
        selected = self.home / "selected profile"
        self.invoke("--codex-home", str(selected), environment=environment)
        self.assertIn(START, (selected / "AGENTS.md").read_bytes())
        self.assertFalse(self.guidance.exists())

    def test_symlink_and_its_target_are_preserved(self):
        shared = self.home / "shared-guidance.md"
        original = b"# Shared defaults\n"
        shared.write_bytes(original)
        self.guidance.symlink_to(shared)
        self.invoke()
        self.assertTrue(self.guidance.is_symlink())
        self.assertEqual(self.guidance.resolve(), shared.resolve())
        self.assertTrue(shared.read_bytes().startswith(original))
        self.assertIn(START, shared.read_bytes())
        self.assertEqual(self.backups(shared)[0].read_bytes(), original)
        self.invoke("--check")

    def test_malformed_markers_fail_without_writes(self):
        cases = [
            START + b"\nmissing end\n",
            END + b"\n" + START + b"\n",
            START + b"\n" + END + b"\n" + START + b"\n" + END + b"\n",
            b"inline " + START + b"\n" + END + b"\n",
        ]
        for original in cases:
            with self.subTest(original=original):
                self.guidance.write_bytes(original)
                self.invoke(expected=2)
                self.assertEqual(self.guidance.read_bytes(), original)
                self.assertEqual(self.backups(), [])

    def test_missing_style_refuses_setup_and_accepts_verified_explicit_path(self):
        relocated = self.home / "elsewhere" / "style"
        relocated.parent.mkdir()
        shutil.move(self.installed / "korean-writing-style", relocated)
        self.invoke(expected=2)
        self.assertFalse(self.guidance.exists())
        invalid = self.home / "not-a-style.md"
        invalid.write_text("---\nname: other\n---\nNot this skill.\n")
        self.invoke("--style-skill", str(invalid), expected=2)
        self.assertFalse(self.guidance.exists())
        self.invoke("--style-skill", str(relocated / "SKILL.md"))
        self.invoke("--check", "--style-skill", str(relocated / "SKILL.md"))

    def test_actual_installer_bundle_runs_with_rewritten_skill_names(self):
        target = self.home / "installed by installer" / "skills"
        result = subprocess.run(
            ["bash", str(ROOT / "install.sh"), "--target", str(target)],
            env=self.environment, cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        style = target / "korean-writing-style" / "SKILL.md"
        self.assertIn("name: korean-writing-style\n", style.read_text())
        script = target / "korean-writing-setup" / "scripts" / "setup_global.py"
        profile = self.home / "installer profile"
        self.invoke("--codex-home", str(profile), script=script)
        self.invoke("--codex-home", str(profile), "--check", script=script)
        self.assertIn(START, (profile / "AGENTS.md").read_bytes())


if __name__ == "__main__":
    unittest.main()
