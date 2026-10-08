"""Regression checks for local startup safety. No real Docker/data/model calls."""

import http.server
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import dev


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.processes = []
        self.patches = []
        for name, path in (("ROOT", self.root), ("RUN_DIR", self.root / "logs/dev"),
                           ("STATE", self.root / "logs/dev/state.json"),
                           ("BACKEND_LOG", self.root / "logs/backend.log"),
                           ("FRONTEND_LOG", self.root / "logs/frontend.log")):
            handle = patch.object(dev, name, path)
            handle.start()
            self.patches.append(handle)
        dev.RUN_DIR.mkdir(parents=True)

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        for handle in reversed(self.patches):
            handle.stop()
        self.temp.cleanup()

    def child(self, source="import time; time.sleep(120)"):
        process = subprocess.Popen([sys.executable, "-c", source], cwd=self.root,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
        self.processes.append(process)
        return process

    def state(self, children):
        return {"root": str(self.root), "children": children}

    def test_stale_pid_identity_never_kills_an_unrelated_process(self):
        process = self.child()
        record = dev.process_record(process.pid)
        record["identity"] += " stale"
        dev.signal_owned(record, signal.SIGTERM)
        self.assertIsNone(process.poll())

    def test_python_launcher_identity_stays_valid_after_exec(self):
        process = self.child()
        record = dev.process_record(process.pid)
        time.sleep(.15)
        self.assertTrue(dev.alive(record))

    def test_registration_waits_for_real_argv_instead_of_exec_placeholder(self):
        placeholder = "501 Thu Oct 8 12:00:00 2026 (python3.12)"
        real = "501 Thu Oct 8 12:00:00 2026 -m uvicorn app.main:app"
        with patch.object(dev, "process_identity", side_effect=[placeholder, placeholder, real, real]):
            record = dev.process_record(12345, "-m uvicorn app.main:app")
        self.assertEqual(record["identity"], real)

    def test_stop_removes_managed_process_and_state(self):
        process = self.child()
        dev.write_state(self.state({"backend": dev.process_record(process.pid)}))
        dev.stop()
        self.assertEqual(process.wait(timeout=3), -signal.SIGTERM)
        self.assertFalse(dev.STATE.exists())

    def test_crashed_group_leader_does_not_leave_descendants(self):
        pid_file = self.root / "descendant.pid"
        source = ("import os,signal,time,pathlib\n"
                  "pid=os.fork()\n"
                  "if pid:\n time.sleep(.15); os._exit(0)\n"
                  "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                  f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                  "time.sleep(120)\n")
        leader = self.child(source)
        record = dev.process_record(leader.pid)
        deadline = time.monotonic() + 3
        while not pid_file.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        descendant = int(pid_file.read_text())
        time.sleep(.2)  # Leader is a zombie; do not reap it before cleaning its group.
        self.assertTrue(dev.process_identity(descendant))
        dev.stop_children(self.state({"backend": record}), [leader])
        leader.wait(timeout=3)
        deadline = time.monotonic() + 3
        while dev.process_identity(descendant) and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertFalse(dev.process_identity(descendant))

    def test_ipv4_port_conflict_does_not_stop_the_listener(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(dev.StartupError, f"Port {port} is occupied"):
                dev.assert_port_free(port)
            self.assertGreater(listener.fileno(), 0)

    def test_ipv6_only_port_conflict_is_detected(self):
        try:
            listener = socket.socket(socket.AF_INET6)
            listener.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            listener.bind(("::1", 0))
        except OSError:
            self.skipTest("IPv6 disabled")
        with listener:
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(dev.StartupError, f"Port {port} is occupied"):
                dev.assert_port_free(port)

    def test_available_ephemeral_port_is_accepted(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        dev.assert_port_free(port)

    def test_operation_lock_rejects_concurrent_mutation(self):
        with dev.lock("operation.lock"):
            with self.assertRaisesRegex(dev.StartupError, "Another"):
                with dev.lock("operation.lock"):
                    self.fail("second lock acquired")

    def test_foreign_state_is_rejected(self):
        dev.write_state({"root": "/another/checkout", "children": {}})
        with self.assertRaisesRegex(dev.StartupError, "foreign"):
            dev.read_state()

    def test_malformed_process_records_are_rejected(self):
        for children in ([12345], {"backend": 12345}, {"backend": {}},
                         {"backend": {"pid": 12345, "identity": []}}):
            with self.subTest(children=children):
                dev.write_state({"root": str(self.root), "children": children})
                with self.assertRaisesRegex(dev.StartupError, "Invalid process records"):
                    dev.read_state()

    def test_unknown_service_health_response_is_not_accepted(self):
        for payload in (None, [], "OK", {"status": "healthy", "service": "Another App"}):
            with patch.object(dev, "get_json", return_value=payload):
                self.assertFalse(dev.health_ok())

    def test_ready_http_server_with_broken_api_proxy_is_not_ready(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            payload = []

            def do_GET(self):
                body = (b'<html><div id="root"></div></html>' if self.path == "/" else
                        json.dumps(type(self).payload).encode())
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertFalse(dev.frontend_ok(server.server_port))
            Handler.payload = {"knowledge_bases": []}
            self.assertTrue(dev.frontend_ok(server.server_port))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_failed_second_service_cleans_up_first_service(self):
        first = self.child()
        second = self.child("raise SystemExit(7)")
        time.sleep(.2)
        state = self.state({"backend": dev.process_record(first.pid)})
        with self.assertRaisesRegex(dev.StartupError, "process exited"):
            try:
                dev.wait_ready("frontend", lambda: True, [first, second], 2, lambda: False)
            finally:
                dev.stop_children(state, [first, second])
        self.assertEqual(first.wait(timeout=3), -signal.SIGTERM)
        self.assertEqual(second.wait(timeout=3), 7)

    def test_cancelled_startup_does_not_report_ready(self):
        with self.assertRaisesRegex(dev.StartupError, "interrupted"):
            dev.wait_ready("backend", lambda: True, [], 1, lambda: True)

    def test_startup_timeout_is_bounded(self):
        before = time.monotonic()
        with self.assertRaisesRegex(dev.StartupError, "timed out"):
            dev.wait_ready("backend", lambda: False, [], .1, lambda: False)
        self.assertLess(time.monotonic() - before, 1)

    def storage_run(self, containers):
        def fake_run(command, **_kwargs):
            if "inspect" in command:
                container = containers.get(command[-1])
                return subprocess.CompletedProcess(command, 0 if container else 1,
                                                   json.dumps([container]) if container else "", "")
            return subprocess.CompletedProcess(command, 0, "", "")
        return fake_run

    def test_existing_storage_mounts_are_reused_without_compose_recreation(self):
        containers = {}
        for name, destination in zip(dev.STORAGE, ("/data", "/qdrant/storage", "/data")):
            source = self.root / (name + "-original")
            source.mkdir()
            containers[name] = {"Name": name, "Mounts": [{"Type": "bind", "Source": str(source), "Destination": destination}]}
        with patch.object(dev, "docker_command", return_value=(["docker", "--context", "test"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run(containers)) as run_mock, \
             patch.object(dev, "wait_ready"):
            dev.start_storage(True, lambda: False)
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertIn(["docker", "--context", "test", "start", *dev.STORAGE], commands)
        self.assertFalse(any("compose" in command or "up" in command for command in commands))
        self.assertFalse((self.root / "minio_data").exists())

    def test_restored_start_refuses_empty_data(self):
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run({})):
            with self.assertRaisesRegex(dev.StartupError, "requires existing"):
                dev.start_storage(True, lambda: False)
        self.assertFalse((self.root / "minio_data").exists())
        self.assertFalse((self.root / "qdrant_storage").exists())

    def test_partial_storage_is_not_silently_reinitialized(self):
        containers = {dev.STORAGE[0]: {"Name": dev.STORAGE[0], "Mounts": []}}
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run(containers)):
            with self.assertRaisesRegex(dev.StartupError, "incomplete"):
                dev.start_storage(False, lambda: False)
        self.assertFalse((self.root / "minio_data").exists())


if __name__ == "__main__":
    unittest.main()
