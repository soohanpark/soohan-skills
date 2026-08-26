#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
mkdir -p "$TMP_HOME/.codex" "$TMP_HOME/.gemini"   # no .kimi / .agents → must stay undetected

# 1) auto-detect install + 2) frontmatter name rewritten to the installed
#    directory name (<plugin>, or <plugin>-<skill> when a plugin ships several)
HOME="$TMP_HOME" bash "$ROOT/install.sh" >/dev/null
for plugin in "$ROOT"/plugins/*/; do
  plugin_name="$(basename "$plugin")"
  skill_count="$(find "$plugin/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d '[:space:]')"
  for skill_dir in "$plugin"skills/*/; do
    name="$plugin_name"
    [ "$skill_count" -gt 1 ] && name="$plugin_name-$(basename "$skill_dir")"
    for cli in .codex .gemini; do
      [ -f "$TMP_HOME/$cli/skills/$name/SKILL.md" ] || { echo "FAIL: $cli/skills/$name not installed"; exit 1; }
    done
    got="$(sed -n 's/^name: //p' "$TMP_HOME/.codex/skills/$name/SKILL.md" | head -1)"
    [ "$got" = "$name" ] || { echo "FAIL: $name frontmatter name is '$got', expected '$name'"; exit 1; }
  done
done
[ ! -d "$TMP_HOME/.kimi" ] || { echo "FAIL: must not create a skills dir for an absent CLI"; exit 1; }
[ ! -d "$TMP_HOME/.agents" ] || { echo "FAIL: must not create a skills dir for an absent CLI"; exit 1; }

# 3) idempotent — rerunning succeeds and leaves no stale files behind
touch "$TMP_HOME/.codex/skills/work/stale.txt"
HOME="$TMP_HOME" bash "$ROOT/install.sh" >/dev/null
[ ! -f "$TMP_HOME/.codex/skills/work/stale.txt" ] || { echo "FAIL: reinstall left a stale file"; exit 1; }

# 4) --target overrides detection
HOME="$TMP_HOME" bash "$ROOT/install.sh" --target "$TMP_HOME/custom/skills" >/dev/null
[ -f "$TMP_HOME/custom/skills/work/SKILL.md" ] || { echo "FAIL: --target did not install"; exit 1; }

# 5) a plugin with two skills installs as <plugin>-<skill> instead of clobbering
FAKE="$TMP_HOME/fake-repo"
mkdir -p "$FAKE/plugins/duo/skills/alpha" "$FAKE/plugins/duo/skills/beta"
cp "$ROOT/install.sh" "$FAKE/install.sh"
printf -- '---\nname: alpha\n---\n' > "$FAKE/plugins/duo/skills/alpha/SKILL.md"
printf -- '---\nname: beta\n---\n' > "$FAKE/plugins/duo/skills/beta/SKILL.md"
HOME="$TMP_HOME" bash "$FAKE/install.sh" --target "$TMP_HOME/duo/skills" >/dev/null
for s in alpha beta; do
  [ -f "$TMP_HOME/duo/skills/duo-$s/SKILL.md" ] || { echo "FAIL: multi-skill plugin did not install duo-$s"; exit 1; }
  grep -qx "name: duo-$s" "$TMP_HOME/duo/skills/duo-$s/SKILL.md" || { echo "FAIL: duo-$s name not rewritten"; exit 1; }
done

echo "PASS"
