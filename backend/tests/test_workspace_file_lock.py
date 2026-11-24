import subprocess
import sys

from app.core.file_lock import lock_file, unlock_file


def test_lock_excludes_another_process_and_releases(tmp_path):
    path = tmp_path / "workspace.lock"
    code = """
from app.core.file_lock import lock_file
import sys
with open(sys.argv[1], 'a+') as lock:
    try:
        lock_file(lock)
    except OSError:
        sys.exit(23)
"""
    with path.open("a+") as stream:
        lock_file(stream)
        assert subprocess.run([sys.executable, "-c", code, str(path)]).returncode == 23
        unlock_file(stream)
        assert subprocess.run([sys.executable, "-c", code, str(path)]).returncode == 0
