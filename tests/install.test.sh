#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
mkdir -p "$TMP_HOME/.codex" "$TMP_HOME/.gemini"   # no .kimi / .agents → must stay undetected

# 1) auto-detect install
HOME="$TMP_HOME" bash "$ROOT/install.sh" >/dev/null
for cli in .codex .gemini; do
  for plugin in "$ROOT"/plugins/*/; do
    name="$(basename "$plugin")"
    [ -f "$TMP_HOME/$cli/skills/$name/SKILL.md" ] || { echo "FAIL: $cli/skills/$name not installed"; exit 1; }
  done
done
[ ! -d "$TMP_HOME/.kimi" ] || { echo "FAIL: must not create a skills dir for an absent CLI"; exit 1; }
[ ! -d "$TMP_HOME/.agents" ] || { echo "FAIL: must not create a skills dir for an absent CLI"; exit 1; }

# 2) frontmatter name is rewritten to the installed directory name — the open
#    standard requires them to match, and sources use short inner names.
for plugin in "$ROOT"/plugins/*/; do
  name="$(basename "$plugin")"
  got="$(sed -n 's/^name: //p' "$TMP_HOME/.codex/skills/$name/SKILL.md" | head -1)"
  [ "$got" = "$name" ] || { echo "FAIL: $name frontmatter name is '$got', expected '$name'"; exit 1; }
done

# 3) idempotent — rerunning succeeds and leaves no stale files behind
touch "$TMP_HOME/.codex/skills/blin-mr/stale.txt"
HOME="$TMP_HOME" bash "$ROOT/install.sh" >/dev/null
[ ! -f "$TMP_HOME/.codex/skills/blin-mr/stale.txt" ] || { echo "FAIL: reinstall left a stale file"; exit 1; }

# 4) --target overrides detection
HOME="$TMP_HOME" bash "$ROOT/install.sh" --target "$TMP_HOME/custom/skills" >/dev/null
[ -f "$TMP_HOME/custom/skills/blin-mr/SKILL.md" ] || { echo "FAIL: --target did not install"; exit 1; }

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
