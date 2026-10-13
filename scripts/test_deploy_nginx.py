"""Exercise production SPA routing in an isolated nginx container (requires Docker)."""
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class FrontendRoutingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Keep bind mounts under the repository for macOS Docker file sharing.
        scratch = ROOT / "data"
        scratch.mkdir(exist_ok=True)
        temp = tempfile.TemporaryDirectory(prefix="nginx-routing-", dir=scratch)
        cls.addClassCleanup(temp.cleanup)
        public = Path(temp.name)
        public.chmod(0o755)
        cls.index = b"<!doctype html><title>Tessmora routing fixture</title>"
        (public / "index.html").write_bytes(cls.index)
        for directory in ("knowledge", "architecture", "assets"):
            (public / directory).mkdir()
            (public / directory / "fixture.txt").write_text("static fixture")
        container = subprocess.check_output([
            "docker", "run", "--rm", "-d", "-p", "127.0.0.1::80",
            "-v", f"{ROOT / 'deploy/nginx.conf'}:/etc/nginx/conf.d/default.conf:ro",
            "-v", f"{public}:/usr/share/nginx/html:ro", "nginx:1.28-alpine",
        ], text=True).strip()
        cls.addClassCleanup(subprocess.run, ["docker", "rm", "-f", container],
                            check=True, stdout=subprocess.DEVNULL)
        port = subprocess.check_output(["docker", "port", container, "80/tcp"], text=True).strip().rsplit(":", 1)[1]
        cls.base = f"http://127.0.0.1:{port}"
        cls.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        deadline = time.monotonic() + 15
        while True:
            try:
                with cls.http.open(cls.base, timeout=2):
                    break
            except urllib.error.URLError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)

    def test_spa_paths_never_redirect_or_serve_public_directories(self):
        for path in ("/", "/knowledge", "/knowledge/", "/knowledge/old-space", "/architecture", "/architecture/", "/setup"):
            with self.subTest(path=path), self.http.open(self.base + path, timeout=2) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), self.index)
                self.assertEqual(response.headers["Cache-Control"], "no-cache")

    def test_static_files_remain_accessible(self):
        for directory in ("knowledge", "architecture", "assets"):
            with self.subTest(directory=directory), self.http.open(f"{self.base}/{directory}/fixture.txt", timeout=2) as response:
                self.assertEqual(response.read(), b"static fixture")

    def test_missing_hashed_asset_is_not_html(self):
        with self.assertRaises(urllib.error.HTTPError) as failure:
            self.http.open(self.base + "/assets/missing.js", timeout=2)
        self.assertEqual(failure.exception.code, 404)
        failure.exception.close()


if __name__ == "__main__":
    unittest.main()
