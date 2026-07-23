#!/usr/bin/env bash
set -euo pipefail

# soohan-skills installer — copies plugins/*/skills/*/ into each CLI's skills directory.
# Usage:
#   ./install.sh                    # auto-detect ~/.codex ~/.gemini ~/.kimi ~/.agents
#   ./install.sh --target <dir>     # explicit skills dir (repeatable)
#   curl -fsSL https://raw.githubusercontent.com/soohanpark/soohan-skills/main/install.sh | bash
#
# Claude Code does not need this — it installs via /plugin marketplace add.

REPO_URL="https://github.com/soohanpark/soohan-skills"

# Source: the checkout next to this script, or a temp clone when piped from curl.
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd)"
if [ ! -d "$SRC_DIR/plugins" ]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  git clone --quiet --depth 1 "$REPO_URL" "$TMP_DIR/soohan-skills"
  SRC_DIR="$TMP_DIR/soohan-skills"
fi

TARGETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGETS+=("$2"); shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  for cli in codex gemini kimi agents; do
    [ -d "$HOME/.$cli" ] && TARGETS+=("$HOME/.$cli/skills")
  done
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "no CLI found (~/.codex, ~/.gemini, ~/.kimi, ~/.agents all missing)." >&2
  echo "set one explicitly: ./install.sh --target <skills-dir>" >&2
  exit 1
fi

count=0
for plugin_dir in "$SRC_DIR"/plugins/*/; do
  plugin="$(basename "$plugin_dir")"
  [ -d "$plugin_dir/skills" ] || continue

  # Install name is the plugin name — users remember "blin-mr", not "write".
  # Only plugins shipping more than one skill fall back to <plugin>-<skill>,
  # otherwise the second skill would silently clobber the first.
  skill_count="$(find "$plugin_dir/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d '[:space:]')"

  for skill_dir in "$plugin_dir"skills/*/; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill="$(basename "$skill_dir")"
    name="$plugin"
    [ "$skill_count" -gt 1 ] && name="$plugin-$skill"

    for target in "${TARGETS[@]}"; do
      mkdir -p "$target"
      rm -rf "${target:?}/$name"
      cp -R "$skill_dir" "$target/$name"
      # The open standard wants frontmatter name == directory name. Sources use
      # short inner names (write/run) so Claude lists them as <plugin>:<skill>,
      # so rewrite the first name: line to match the installed directory.
      awk -v n="$name" '!seen && sub(/^name: .*/, "name: " n) { seen = 1 } 1' \
        "$skill_dir/SKILL.md" > "$target/$name/SKILL.md"
    done
    count=$((count + 1))
  done
done

[ "$count" -gt 0 ] || { echo "no skills found under $SRC_DIR/plugins" >&2; exit 1; }

for target in "${TARGETS[@]}"; do
  echo "✅ $count skill(s) installed → $target"
done

echo "ℹ️  Slash commands are Claude-only; other CLIs trigger these skills from their description."
