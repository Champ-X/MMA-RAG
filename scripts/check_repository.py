#!/usr/bin/env python3
"""Check distributed files and local documentation links using only the Git index."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 5 * 1024 * 1024
FORBIDDEN = (
    'static/', 'ops/', 'data/', 'logs/', 'docs/research/', 'docs/qa/',
    'docs/verification/', 'backend/experiments/', 'frontend/dist/',
    'minio_data/', 'qdrant_storage/',
)
EVAL_INPUTS = {'README.md', 'baseline_v1', 'baselines', 'decision_plan_v2', 'decision_plan_v2_holdout'}


def main():
    files = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    errors = []
    total = 0
    for name in sorted(files):
        parts = Path(name).parts
        path = ROOT / name
        if name.startswith(FORBIDDEN) or 'node_modules' in parts or '__pycache__' in parts:
            errors.append(f'{name}: generated or local-only path')
        if Path(name).name.startswith('.env') and Path(name).name != '.env.example':
            errors.append(f'{name}: local environment file')
        if name in {'backend/data/llm_task_overrides.json', 'backend/data/jev_settings.json'}:
            errors.append(f'{name}: mutable user configuration')
        if parts[0] == 'evals' and (len(parts) < 2 or parts[1] not in EVAL_INPUTS):
            errors.append(f'{name}: evaluation input requires explicit review')
        if not path.is_file():
            errors.append(f'{name}: tracked file missing from checkout')
            continue
        size = path.stat().st_size
        total += size
        if size > MAX_FILE_BYTES:
            errors.append(f'{name}: {size} bytes exceeds 5 MiB; use an external artifact or review the limit')
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
            if rel not in files and not any(f.startswith(rel.rstrip('/') + '/') for f in files):
                errors.append(f'{name}: link absent from distributed files: {link}')
    for error in errors:
        print(error, file=sys.stderr)
    print(f'{len(files)} tracked files, {total / 1024 / 1024:.2f} MiB; {len(errors)} repository errors')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
