"""Check publication boundaries in disposable Git repositories; no app services."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).with_name("check_repository.py")


class RepositoryChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.git("init", "--quiet")
        self.write("scripts/check_repository.py", CHECKER.read_text(encoding="utf-8"))
        self.git("add", "scripts/check_repository.py")

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.root, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def track(self, name, content):
        self.write(name, content)
        self.git("add", "--", name)

    def check(self, *args):
        return subprocess.run(
            [sys.executable, "scripts/check_repository.py", *args],
            cwd=self.root, text=True, capture_output=True, check=False,
        )

    def assert_passes(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("0 repository errors", result.stdout)

    def test_maintained_fixtures_examples_and_local_links_are_distributed(self):
        self.track(".env.example", "EXAMPLE_KEY=replace-me\n")
        self.track("backend/.env.example", "EXAMPLE_KEY=replace-me\n")
        self.track("backend/tests/fixtures/sample.txt", "synthetic fixture\n")
        self.track("evals/baseline_v1/corpus/sample.md", "# Synthetic\n")
        self.track("docs/with space.md", "# Guide\n")
        self.track("README.md", """# Project
[Fixture](backend/tests/fixtures/sample.txt)
[Corpus](evals/baseline_v1/corpus/)
[Guide](docs/with%20space.md#guide)
<a href="backend/.env.example">Example environment</a>
[External](https://example.com/missing.md)
[Heading](#project)
```markdown
[An illustrative path](not-a-real-file.md)
```
""")
        self.assert_passes(self.check())
        self.assert_passes(self.check("--worktree"))

    def test_forced_tracking_cannot_bypass_local_artifact_rules(self):
        names = (
            "ops/receipt.json", "backend/data/settings.json", "output/render.png",
            "docs/qa/run.md", "frontend/test-results/result.json",
            "packages/cli/node_modules/dependency/index.js", ".venv-local/bin/python",
            "backend/.env", "deploy/.env.production", "evals/runs/run.json",
        )
        self.track(".gitignore", "\n".join(names) + "\n")
        for name in names:
            self.write(name, "local-only fixture\n")
        self.git("add", "--force", "--", *names)
        for args in ((), ("--worktree",)):
            with self.subTest(args=args):
                result = self.check(*args)
                self.assertNotEqual(result.returncode, 0)
                for name in names:
                    self.assertIn(name + ":", result.stderr)

    def test_ignored_local_files_do_not_satisfy_distributed_links(self):
        self.track(".gitignore", "/ops/\n")
        self.write("ops/receipt.md", "# Private run\n")
        self.track("README.md", "[Receipt](ops/receipt.md)\n[Runs](ops/)\n")
        for args in ((), ("--worktree",)):
            with self.subTest(args=args):
                result = self.check(*args)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("link absent from distributed files: ops/receipt.md", result.stderr)
                self.assertIn("link absent from distributed files: ops/", result.stderr)

    def test_worktree_checks_pending_additions_and_deletions_without_staging(self):
        self.track("docs/old.md", "# Retired\n")
        self.track("README.md", "[Guide](docs/old.md)\n")
        (self.root / "docs/old.md").unlink()
        self.write("docs/new.md", "# Maintained\n")
        self.write("README.md", "[Guide](docs/new.md)\n")
        before = (self.root / ".git/index").read_bytes()
        result = self.check("--worktree")
        self.assert_passes(result)
        self.assertEqual((self.root / ".git/index").read_bytes(), before)
        self.assertEqual(self.git("ls-files", "--", "docs"), b"docs/old.md\n")
        indexed = self.check()
        self.assertNotEqual(indexed.returncode, 0)
        self.assertIn("docs/old.md: tracked file missing from checkout", indexed.stderr)
        self.assertIn("link absent from distributed files: docs/new.md", indexed.stderr)

    def test_deleting_a_link_target_still_fails_worktree_check(self):
        self.track("docs/guide.md", "# Guide\n")
        self.track("README.md", "[Guide](docs/guide.md)\n")
        (self.root / "docs/guide.md").unlink()
        result = self.check("--worktree")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("link absent from distributed files: docs/guide.md", result.stderr)

    def test_default_check_reports_missing_tracked_files_without_links(self):
        self.track("backend/tests/fixtures/input.txt", "synthetic\n")
        (self.root / "backend/tests/fixtures/input.txt").unlink()
        result = self.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracked file missing from checkout", result.stderr)
        self.assert_passes(self.check("--worktree"))

    def test_links_to_repository_root_are_valid_directory_links(self):
        self.track("README.md", "[Repository](.)\n")
        self.track("docs/README.md", "[Repository](../)\n")
        self.assert_passes(self.check())


if __name__ == "__main__":
    unittest.main()
