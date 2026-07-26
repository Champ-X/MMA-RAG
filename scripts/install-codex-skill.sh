#!/bin/sh

set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
skill_source="$repo_root/skills/mma-rag"
codex_root="${CODEX_HOME:-${HOME}/.codex}"
skill_parent="$codex_root/skills"
skill_target="$skill_parent/mma-rag"

if [ ! -f "$skill_source/SKILL.md" ]; then
    echo "MMA-RAG skill source is missing: $skill_source" >&2
    exit 1
fi

mkdir -p "$skill_parent"

if [ -L "$skill_target" ]; then
    current_target="$(readlink "$skill_target")"
    if [ "$current_target" = "$skill_source" ]; then
        echo "MMA-RAG Codex skill is already installed: $skill_target"
        exit 0
    fi
    echo "Refusing to replace existing skill symlink: $skill_target -> $current_target" >&2
    exit 2
fi

if [ -e "$skill_target" ]; then
    echo "Refusing to replace existing skill path: $skill_target" >&2
    exit 2
fi

ln -s "$skill_source" "$skill_target"
echo "Installed MMA-RAG Codex skill: $skill_target -> $skill_source"
