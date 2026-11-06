#!/usr/bin/env python3
"""Check distribution paths and links, using indexed names or pending worktree files."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 5 * 1024 * 1024
# README introductions are deliberate distribution assets, not production drafts.
# Keep the larger allowance scoped to these two reviewed 720p exports.
FILE_SIZE_LIMITS = {
    'docs/media/tessmora-intro/tessmora-intro-zh.mp4': 24 * 1024 * 1024,
    'docs/media/tessmora-intro/tessmora-intro-en.mp4': 24 * 1024 * 1024,
}
FORBIDDEN = (
    'static/', 'ops/', 'data/', 'logs/', 'docs/research/', 'docs/qa/',
    'docs/verification/', 'backend/experiments/', 'frontend/dist/',
    'minio_data/', 'qdrant_storage/', 'backend/data/', 'backend/logs/',
    '.agent-tasks/', 'output/', 'video-production/', 'docs/previews/',
    'frontend/design-previews/', '.impeccable/review/', '.impeccable/review-gallery/',
    'frontend/coverage/', 'frontend/playwright-report/', 'frontend/test-results/',
    'tmp/', 'temp/',
)
EVAL_INPUTS = {'README.md', 'baseline_v1', 'baselines', 'decision_plan_v2', 'decision_plan_v2_holdout'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worktree', action='store_true', help='check pending additions/deletions without changing the Git index')
    args = parser.parse_args()
    command = ['git', 'ls-files', '-z']
    if args.worktree:
        command += ['--cached', '--others', '--exclude-standard']
    files = set(subprocess.check_output(command, cwd=ROOT).decode().split('\0')) - {''}
    if args.worktree:
        deleted = set(subprocess.check_output(['git', 'ls-files', '--deleted', '-z'], cwd=ROOT).decode().split('\0'))
        files -= deleted
    errors = []
    total = 0
    for name in sorted(files):
        parts = Path(name).parts
        path = ROOT / name
        if (name.startswith(FORBIDDEN)
                or any(part in {'node_modules', '__pycache__', '.pytest_cache', '.venv'} for part in parts)
                or parts[0].startswith('.venv-')):
            errors.append(f'{name}: generated or local-only path')
        if Path(name).name.startswith('.env') and Path(name).name != '.env.example':
            errors.append(f'{name}: local environment file')
        if parts[0] == 'evals' and (len(parts) < 2 or parts[1] not in EVAL_INPUTS):
            errors.append(f'{name}: evaluation input requires explicit review')
        if not path.is_file():
            errors.append(f'{name}: tracked file missing from checkout')
            continue
        size = path.stat().st_size
        total += size
        limit = FILE_SIZE_LIMITS.get(name, MAX_FILE_BYTES)
        if size > limit:
            errors.append(f'{name}: {size} bytes exceeds {limit // (1024 * 1024)} MiB; use an external artifact or review the limit')
        if path.suffix != '.md':
            continue
        # Fenced examples are not rendered links. Validate inline Markdown and HTML links.
        content = re.sub(r'^(`{3,}|~{3,}).*?^\1[^\n]*$', '', path.read_text(), flags=re.M | re.S)
        links = re.findall(r'\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)', content)
        links += re.findall(r'(?:src|href)=["\']([^"\']+)["\']', content)
        for link in links:
            target = unquote(urlsplit(link.strip('<>')).path)
            if not target or urlsplit(link).scheme or link.startswith('//'):
                continue
            resolved = (path.parent / target).resolve()
            try:
                rel = resolved.relative_to(ROOT).as_posix()
            except ValueError:
                errors.append(f'{name}: link outside repository: {link}')
                continue
            if rel != '.' and rel not in files and not any(f.startswith(rel.rstrip('/') + '/') for f in files):
                errors.append(f'{name}: link absent from distributed files: {link}')
    for error in errors:
        print(error, file=sys.stderr)
    scope = 'worktree candidate' if args.worktree else 'tracked'
    print(f'{len(files)} {scope} files, {total / 1024 / 1024:.2f} MiB; {len(errors)} repository errors')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
