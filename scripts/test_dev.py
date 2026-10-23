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
from unittest.mock import Mock, patch

import dev


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.processes = []
        self.patches = []
        storage_env = patch.dict(os.environ, {"MMA_STORAGE_ROOT": str(self.root / "stable-storage")})
        storage_env.start()
        self.patches.append(storage_env)
        for name, path in (("ROOT", self.root), ("RUN_DIR", self.root / "logs/dev"),
                           ("STATE", self.root / "logs/dev/state.json"),
                           ("SUPERVISOR_LOG", self.root / "logs/dev/supervisor.log"),
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

    def colima_run(self, containers, profiles, *, context_exists=False, endpoint="unix:///tmp/docker.sock"):
        started = False

        def fake_run(command, **_kwargs):
            nonlocal started, context_exists
            code, output = 0, ""
            if command == ["colima", "list", "--json"]:
                output = "\n".join(json.dumps(profile) for profile in profiles)
            elif command[0:2] == ["colima", "start"]:
                started = context_exists = True
            elif command == ["docker", "context", "inspect", "colima-mma-rag"]:
                code = 0 if context_exists else 1
            elif command == ["docker", "context", "show"]:
                output = "default"
            elif command[0:2] == ["docker", "--context"] and "context" in command[3:]:
                code = 1 if command[2] == "colima-mma-rag" and not context_exists else 0
                output = endpoint if code == 0 else ""
            elif command[-1] == "info":
                code = 0 if started or command[2] != "colima-mma-rag" else 1
            else:
                return self.storage_run(containers)(command)
            return subprocess.CompletedProcess(command, code, output, "")

        return fake_run

    def test_stopped_colima_profile_without_context_is_started_and_endpoint_rechecked(self):
        profiles = [{"name": "mma-rag", "runtime": "docker", "status": "Stopped"}]
        containers = self.storage_containers()
        with patch.dict(os.environ, {}, clear=True), patch.object(dev.shutil, "which", return_value="/mock/tool"), \
             patch.object(dev, "run", side_effect=self.colima_run(containers, profiles)) as run_mock, \
             patch.object(dev, "wait_ready"):
            dev.start_storage(True, lambda: False)
        commands = [call.args[0] for call in run_mock.call_args_list]
        start = ["colima", "start", "--profile", "mma-rag", "--activate=false"]
        self.assertIn(start, commands)
        subsequent = commands[commands.index(start) + 1:]
        self.assertTrue(any("--format" in command for command in subsequent))
        self.assertIn(["docker", "--context", "colima-mma-rag", "start", *dev.STORAGE], subsequent)
        self.assertFalse(any("use" in command or "create" in command for command in commands))

    def test_doctor_reports_stopped_profile_without_starting_it(self):
        profiles = [{"name": "mma-rag", "runtime": "docker", "status": "Stopped"}]
        with patch.dict(os.environ, {}, clear=True), patch.object(dev.shutil, "which", return_value="/mock/tool"), \
             patch.object(sys, "argv", ["dev.py", "doctor"]), patch.object(dev, "preflight"), \
             patch.object(dev, "run", side_effect=self.colima_run({}, profiles)) as run_mock, \
             patch.object(dev, "say") as say:
            self.assertEqual(dev.main(), 1)
        self.assertTrue(any("mma-rag is Stopped" in call.args[0] for call in say.call_args_list))
        self.assertFalse(any("start" in call.args[0] for call in run_mock.call_args_list))

    def test_explicit_docker_context_takes_priority_and_remote_endpoint_is_rejected(self):
        for endpoint in ("unix:///tmp/docker.sock", "tcp://remote.example:2376"):
            with self.subTest(endpoint=endpoint), patch.dict(os.environ, {"MMA_DOCKER_CONTEXT": "chosen"}, clear=True), \
                 patch.object(dev.shutil, "which", return_value="/mock/tool"), \
                 patch.object(dev, "run", side_effect=self.colima_run({}, [], endpoint=endpoint)) as run_mock:
                if endpoint.startswith("unix:"):
                    self.assertEqual(dev.docker_command(allow_stopped_colima=True)[2], "chosen")
                else:
                    with self.assertRaisesRegex(dev.StartupError, "local Unix-socket"):
                        dev.docker_command(allow_stopped_colima=True)
                self.assertFalse(any(call.args[0][0] == "colima" for call in run_mock.call_args_list))

    def test_unknown_or_non_docker_colima_profile_is_not_selected_or_created(self):
        for profiles in ([], [{"name": "other", "runtime": "docker"}], [{"name": "mma-rag", "runtime": "containerd"}]):
            with self.subTest(profiles=profiles), patch.dict(os.environ, {}, clear=True), \
                 patch.object(dev.shutil, "which", return_value="/mock/tool"), \
                 patch.object(dev, "run", side_effect=self.colima_run({}, profiles)) as run_mock:
                self.assertEqual(dev.docker_command(allow_stopped_colima=True)[2], "default")
                self.assertFalse(any("start" in call.args[0] for call in run_mock.call_args_list))
        with patch.dict(os.environ, {}, clear=True), patch.object(dev.shutil, "which", return_value="/mock/tool"), \
             patch.object(dev, "run", side_effect=self.colima_run({}, [], context_exists=True)) as run_mock:
            with self.assertRaisesRegex(dev.StartupError, "Start Docker context"):
                dev.start_storage(True, lambda: False)
        self.assertFalse(any("start" in call.args[0] for call in run_mock.call_args_list))

    def test_recreated_colima_context_must_still_use_a_local_endpoint(self):
        profiles = [{"name": "mma-rag", "runtime": "docker", "status": "Stopped"}]
        with patch.dict(os.environ, {}, clear=True), patch.object(dev.shutil, "which", return_value="/mock/tool"), \
             patch.object(dev, "run", side_effect=self.colima_run({}, profiles, endpoint="tcp://remote.example:2376")) as run_mock:
            with self.assertRaisesRegex(dev.StartupError, "local Unix-socket"):
                dev.start_storage(True, lambda: False)
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertIn(["colima", "start", "--profile", "mma-rag", "--activate=false"], commands)
        self.assertFalse(any("container" in command or "compose" in command for command in commands))

    def test_colima_profile_detection_accepts_json_lines_and_arrays_but_not_bad_json(self):
        profile = {"name": "mma-rag", "runtime": "docker", "status": "Stopped"}
        for payload in (json.dumps(profile), json.dumps([profile]), '{}\n' + json.dumps(profile)):
            with self.subTest(payload=payload), patch.object(dev.shutil, "which", return_value="/mock/colima"), \
                 patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, payload, "")):
                self.assertEqual(dev.colima_profile(), profile)
        with patch.object(dev.shutil, "which", return_value="/mock/colima"), \
             patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, "not JSON", "")):
            self.assertIsNone(dev.colima_profile())

    def storage_run(self, containers):
        def fake_run(command, **_kwargs):
            if "inspect" in command:
                container = containers.get(command[-1])
                return subprocess.CompletedProcess(command, 0 if container else 1,
                                                   json.dumps([container]) if container else "", "")
            return subprocess.CompletedProcess(command, 0, "", "")
        return fake_run

    def managed_storage_run(self, containers, *, fail_after=None, initializing_qdrant=False, compose_plugin=True):
        failure_pending = fail_after is not None

        def fake_run(command, **kwargs):
            nonlocal failure_pending
            if command[-2:] == ["compose", "version"]:
                return subprocess.CompletedProcess(command, 0 if compose_plugin else 1, "", "")
            if "rename" in command:
                identity, new_name = command[-2:]
                old_name = next(name for name, container in containers.items() if container["Id"] == identity)
                container = containers.pop(old_name)
                container["Name"] = "/" + new_name
                containers[new_name] = container
            elif "up" in command:
                project = command[command.index("-p") + 1]
                files = [command[index + 1] for index, arg in enumerate(command) if arg == "-f"]
                overlay = json.loads(Path(files[-1]).read_text())
                for index, (service, name) in enumerate(zip(("minio", "qdrant", "redis"), dev.STORAGE)):
                    if name not in containers:
                        mount = overlay["services"][service]["volumes"][0]
                        containers[name] = {"Id": "new-" + name, "Name": "/" + name,
                                            "Config": {"Labels": {"com.docker.compose.project": project}},
                                            "Mounts": [{"Type": "bind", "Source": mount["source"], "Destination": mount["target"]}]}
                        if service == "qdrant":
                            if initializing_qdrant:
                                (Path(mount["source"]) / "initializing.tmp").write_text("pending")
                            else:
                                (Path(mount["source"]) / "collections").mkdir(exist_ok=True)
                    if failure_pending and index + 1 == fail_after:
                        failure_pending = False
                        raise dev.StartupError("simulated interrupted Compose initialization")
            return self.storage_run(containers)(command, **kwargs)

        return fake_run

    def storage_containers(self):
        containers = {}
        for name, destination in zip(dev.STORAGE, ("/data", "/qdrant/storage", "/data")):
            source = self.root / (name + "-original")
            source.mkdir()
            containers[name] = {"Id": "old-" + name, "Name": name, "Image": "sha256:existing",
                                "Config": {"Labels": {"com.docker.compose.project": "original-project"}},
                                "Mounts": [{"Type": "bind", "Source": str(source), "Destination": destination}]}
        (self.root / (dev.STORAGE[0] + "-original") / ".minio.sys").mkdir()
        (self.root / (dev.STORAGE[1] + "-original") / "collections").mkdir()
        return containers

    def remove_storage_source(self, container):
        source = Path(container["Mounts"][0]["Source"])
        for marker in source.iterdir():
            marker.rmdir()
        source.rmdir()
        return source

    def test_existing_storage_mounts_are_reused_without_compose_recreation(self):
        containers = self.storage_containers()
        with patch.object(dev, "docker_command", return_value=(["docker", "--context", "test"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run(containers)) as run_mock, \
             patch.object(dev, "wait_ready"):
            dev.start_storage(True, lambda: False)
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertIn(["docker", "--context", "test", "start", *dev.STORAGE], commands)
        self.assertFalse(any("compose" in command or "up" in command for command in commands))
        self.assertFalse((self.root / "minio_data").exists())

    def test_normal_start_preserves_missing_stores_and_creates_isolated_dataset(self):
        containers = self.storage_containers()
        old_ids = {container["Id"] for container in containers.values()}
        old_redis = Path(containers[dev.STORAGE[2]]["Mounts"][0]["Source"]) / "dump.rdb"
        old_redis.write_bytes(b"retained original Redis data")
        containers[dev.STORAGE[0]]["HostConfig"] = {"RestartPolicy": {"Name": "always"}}
        for name in dev.STORAGE[:2]:
            self.remove_storage_source(containers[name])
        with patch.object(dev, "docker_command", return_value=(["docker"], {"DOCKER_CONTEXT": "test"}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers)) as run_mock, \
             patch.object(dev, "wait_ready"):
            dev.start_storage(False, lambda: False)
        self.assertEqual(len(containers), 6)
        preserved = [container for name, container in containers.items() if "__preserved_" in name]
        self.assertEqual({container["Id"] for container in preserved}, old_ids)
        self.assertEqual(old_redis.read_bytes(), b"retained original Redis data")
        record = json.loads((dev.RUN_DIR / "storage-bootstrap.json").read_text())
        self.assertTrue(record["project"].startswith("tessmora-dev-"))
        self.assertNotEqual(record["project"], "original-project")
        for name, folder in zip(dev.STORAGE, ("minio_data", "qdrant_storage", "redis_data")):
            self.assertEqual(record["sources"][name], str(self.root / "stable-storage" / folder))
        receipts = list(dev.RUN_DIR.glob("storage-preserved-*.json"))
        self.assertEqual(len(receipts), 1)
        receipt = json.loads(receipts[0].read_text())
        self.assertEqual({item["id"] for item in receipt["containers"]}, old_ids)
        self.assertEqual(receipt["status"], "preserved")
        self.assertFalse(any("Config" in item for item in receipt["containers"]))
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertIn(["docker", "update", "--restart=no", "old-mmrag_minio"], commands)
        self.assertFalse(any("rm" in command or "down" in command or "prune" in command for command in commands))
        self.assertFalse((self.root / "minio_data").exists())

    def test_normal_start_replaces_empty_old_stores_without_reusing_their_paths(self):
        containers = self.storage_containers()
        for name, marker in zip(dev.STORAGE[:2], (".minio.sys", "collections")):
            (Path(containers[name]["Mounts"][0]["Source"]) / marker).rmdir()
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers)), patch.object(dev, "wait_ready"):
            dev.start_storage(False, lambda: False)
        for name in dev.STORAGE[:2]:
            old_source = self.root / (name + "-original")
            self.assertEqual(list(old_source.iterdir()), [])
            self.assertNotEqual(containers[name]["Mounts"][0]["Source"], str(old_source))
        self.assertEqual(len(list(dev.RUN_DIR.glob("storage-preserved-*.json"))), 1)

    def test_existing_legacy_data_takes_priority_during_bootstrap(self):
        for directory, marker in (("minio_data", ".minio.sys"), ("qdrant_storage", "collections")):
            (self.root / directory / marker).mkdir(parents=True)
            (self.root / directory / "original-data").write_bytes(b"keep")
        containers = {}
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers)), patch.object(dev, "wait_ready"):
            dev.start_storage(False, lambda: False)
        self.assertEqual(containers[dev.STORAGE[0]]["Mounts"][0]["Source"], str(self.root / "minio_data"))
        self.assertEqual(containers[dev.STORAGE[1]]["Mounts"][0]["Source"], str(self.root / "qdrant_storage"))
        self.assertEqual((self.root / "minio_data/original-data").read_bytes(), b"keep")
        self.assertFalse(list(dev.RUN_DIR.glob("storage-preserved-*.json")))

    def test_nonempty_unknown_storage_is_not_archived_or_overwritten(self):
        containers = self.storage_containers()
        source = Path(containers[dev.STORAGE[0]]["Mounts"][0]["Source"])
        (source / ".minio.sys").rmdir()
        (source / "unknown-data").write_bytes(b"keep")
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers)) as run_mock:
            with self.assertRaisesRegex(dev.StartupError, "Nonempty data was retained"):
                dev.start_storage(False, lambda: False)
        self.assertEqual((source / "unknown-data").read_bytes(), b"keep")
        self.assertFalse(any("rename" in call.args[0] or "up" in call.args[0] for call in run_mock.call_args_list))
        self.assertFalse(list(dev.RUN_DIR.glob("storage-preserved-*.json")))

    def test_intentionally_empty_new_minio_reuses_same_containers_on_restart(self):
        containers = {}
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers)) as run_mock, patch.object(dev, "wait_ready"):
            dev.start_storage(False, lambda: False)
            original_ids = {name: container["Id"] for name, container in containers.items()}
            run_mock.reset_mock()
            dev.start_storage(False, lambda: False)
            self.assertFalse(any("rename" in call.args[0] or "up" in call.args[0] for call in run_mock.call_args_list))
            with self.assertRaises(dev.MissingStorageError):
                dev.start_storage(True, lambda: False)
        self.assertEqual({name: container["Id"] for name, container in containers.items()}, original_ids)

    def test_partial_new_bootstrap_resumes_same_project_without_archiving_it(self):
        containers = {}
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers, fail_after=1)) as run_mock, \
             patch.object(dev, "wait_ready"):
            with self.assertRaisesRegex(dev.StartupError, "interrupted Compose"):
                dev.start_storage(False, lambda: False)
            pending = json.loads((dev.RUN_DIR / "storage-bootstrap.json").read_text())
            self.assertEqual(len(containers), 1)
            dev.start_storage(False, lambda: False)
        ready = json.loads((dev.RUN_DIR / "storage-bootstrap.json").read_text())
        self.assertEqual(pending["project"], ready["project"])
        self.assertEqual(ready["phase"], "ready")
        self.assertEqual(len(containers), 3)
        self.assertFalse(any("rename" in call.args[0] for call in run_mock.call_args_list))

    def test_partial_bootstrap_with_foreign_mount_still_refuses_restart(self):
        containers = {}
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers, fail_after=1)) as run_mock:
            with self.assertRaises(dev.StartupError):
                dev.start_storage(False, lambda: False)
            containers[dev.STORAGE[0]]["Mounts"][0]["Source"] = str(self.root / "unknown")
            run_mock.reset_mock()
            with self.assertRaisesRegex(dev.StartupError, "incomplete"):
                dev.start_storage(False, lambda: False)
            self.assertFalse(any("up" in call.args[0] for call in run_mock.call_args_list))

    def test_new_qdrant_initialization_is_allowed_to_finish_before_marker_check(self):
        containers = {}

        def finish_initializing(*_args):
            source = Path(containers[dev.STORAGE[1]]["Mounts"][0]["Source"])
            self.assertTrue((source / "initializing.tmp").exists())
            (source / "collections").mkdir()

        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers, initializing_qdrant=True)), \
             patch.object(dev, "wait_ready", side_effect=finish_initializing):
            dev.start_storage(False, lambda: False)
        record = json.loads((dev.RUN_DIR / "storage-bootstrap.json").read_text())
        self.assertFalse(record["allow_empty"][dev.STORAGE[1]])

    def test_bootstrap_falls_back_to_standalone_compose(self):
        containers = {}
        with patch.object(dev, "docker_command", return_value=(["docker"], {"DOCKER_CONTEXT": "test"}, "test")), \
             patch.object(dev.shutil, "which", return_value="/mock/docker-compose"), \
             patch.object(dev, "run", side_effect=self.managed_storage_run(containers, compose_plugin=False)) as run_mock, \
             patch.object(dev, "wait_ready"):
            dev.start_storage(False, lambda: False)
        up_call = next(call for call in run_mock.call_args_list if "up" in call.args[0])
        self.assertEqual(up_call.args[0][0], "docker-compose")
        self.assertEqual(up_call.kwargs["env"]["DOCKER_CONTEXT"], "test")

    def test_replacement_paths_do_not_overlap_preserved_stable_paths(self):
        containers = self.storage_containers()
        base = self.root / "stable-storage"
        containers[dev.STORAGE[0]]["Mounts"][0]["Source"] = str(base / "minio_data")
        paths = dev.storage_paths("tessmora-dev-new", preserving=list(containers.values()))
        self.assertTrue(all(path.is_relative_to(base / "instances/tessmora-dev-new") for path in paths))

    def test_nested_preserved_mount_uses_an_isolated_replacement_directory(self):
        containers = self.storage_containers()
        base = self.root / "stable-storage"
        containers[dev.STORAGE[0]]["Mounts"][0]["Source"] = str(base / "minio_data" / "old")
        paths = dev.storage_paths("tessmora-dev-new", preserving=list(containers.values()))
        self.assertTrue(all(path.is_relative_to(base / "instances/tessmora-dev-new") for path in paths))

    def test_preserved_parent_mount_cannot_access_new_storage_through_nested_root(self):
        containers = self.storage_containers()
        for symlink in (False, True):
            with self.subTest(symlink=symlink):
                source = Path(containers[dev.STORAGE[0]]["Mounts"][0]["Source"])
                base = source / "replacement"
                if symlink:
                    link = self.root / "storage-alias"
                    link.symlink_to(source, target_is_directory=True)
                    base = link / "replacement"
                with patch.dict(os.environ, {"MMA_STORAGE_ROOT": str(base)}):
                    with self.assertRaisesRegex(dev.StartupError, "overlaps preserved storage"):
                        dev.storage_paths("tessmora-dev-new", preserving=list(containers.values()))
                self.assertFalse(base.exists())

    def test_missing_mount_reports_both_paths_without_starting_or_creating_storage(self):
        containers = self.storage_containers()
        for name in dev.STORAGE[:2]:
            self.remove_storage_source(containers[name])
        with patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run(containers)) as run_mock:
            with self.assertRaises(dev.StartupError) as error:
                dev.start_storage(True, lambda: False)
        message = str(error.exception)
        for name in dev.STORAGE[:2]:
            self.assertIn(containers[name]["Mounts"][0]["Source"], message)
        self.assertIn("Destination='/data'", message)
        self.assertIn("Destination='/qdrant/storage'", message)
        self.assertIn("Type='bind'", message)
        self.assertIn("Do not create empty replacement directories", message)
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertFalse(any("start" in command or "compose" in command for command in commands))
        self.assertFalse((self.root / "minio_data").exists())
        self.assertFalse((self.root / "qdrant_storage").exists())

    def test_broken_symlink_mount_is_rejected_but_existing_target_is_accepted(self):
        containers = self.storage_containers()
        source = self.remove_storage_source(containers[dev.STORAGE[0]])
        target = self.root / "moved-minio"
        source.symlink_to(target, target_is_directory=True)
        with patch.object(dev, "run", side_effect=self.storage_run(containers)):
            with self.assertRaisesRegex(dev.StartupError, "broken symlink"):
                dev.inspect_storage(["docker"], {})
            (target / ".minio.sys").mkdir(parents=True)
            self.assertEqual(len(dev.inspect_storage(["docker"], {})), 3)

    def test_existing_empty_storage_sources_are_rejected_by_read_only_inspection(self):
        containers = self.storage_containers()
        for name, marker in zip(dev.STORAGE[:2], (".minio.sys", "collections")):
            (Path(containers[name]["Mounts"][0]["Source"]) / marker).rmdir()
        for restored in (False, True):
            with self.subTest(restored=restored), \
                 patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
                 patch.object(dev, "run", side_effect=self.storage_run(containers)) as run_mock:
                with self.assertRaises(dev.StartupError) as error:
                    dev.inspect_storage(["docker"], {}, restored)
            message = str(error.exception)
            self.assertIn("uninitialized or empty", message)
            self.assertIn("missing data marker '.minio.sys'", message)
            self.assertIn("missing data marker 'collections'", message)
            self.assertFalse(any("start" in call.args[0] or "compose" in call.args[0] for call in run_mock.call_args_list))
            for name in dev.STORAGE[:2]:
                source = Path(containers[name]["Mounts"][0]["Source"])
                self.assertTrue(source.is_dir())
                self.assertEqual(list(source.iterdir()), [])

    def test_wrong_mount_type_reports_actual_type_and_destination(self):
        containers = self.storage_containers()
        containers[dev.STORAGE[0]]["Mounts"][0]["Type"] = "volume"
        with patch.object(dev, "run", side_effect=self.storage_run(containers)):
            with self.assertRaisesRegex(dev.StartupError, "Type='volume'.*Destination='/data'"):
                dev.inspect_storage(["docker"], {})

    def test_missing_destination_and_empty_source_are_rejected(self):
        containers = self.storage_containers()
        containers[dev.STORAGE[0]]["Mounts"] = []
        containers[dev.STORAGE[1]]["Mounts"][0]["Source"] = ""
        with patch.object(dev, "run", side_effect=self.storage_run(containers)):
            with self.assertRaises(dev.StartupError) as error:
                dev.inspect_storage(["docker"], {})
        self.assertIn("Destination=/data; expected one bind mount, found 0", str(error.exception))
        self.assertIn("Source=''", str(error.exception))

    def test_doctor_rejects_missing_data_without_starting_services(self):
        containers = self.storage_containers()
        source = self.remove_storage_source(containers[dev.STORAGE[0]])
        with patch.object(sys, "argv", ["dev.py", "doctor"]), \
             patch.object(dev, "preflight") as preflight, \
             patch.object(dev, "docker_command", return_value=(["docker"], {}, "test")), \
             patch.object(dev, "run", side_effect=self.storage_run(containers)) as run_mock, \
             patch.object(dev, "say") as say:
            self.assertEqual(dev.main(), 1)
        preflight.assert_called_once_with(install=False)
        self.assertTrue(any(str(source) in str(call.args[0]) for call in say.call_args_list))
        commands = [call.args[0] for call in run_mock.call_args_list]
        self.assertTrue(all(command[1] in ("info", "container") for command in commands))
        self.assertFalse(source.exists())
        self.assertFalse((self.root / "minio_data").exists())

    def test_failed_launch_only_displays_its_own_supervisor_log(self):
        dev.SUPERVISOR_LOG.write_text("Earlier Colima startup / 旧日志\n")
        args = dev.argparse.Namespace(port=3001, timeout=300, restored=False, reload=False, background=True)

        def failed_supervisor(_command, **kwargs):
            kwargs["stdout"].write("Current missing mount error\n")
            kwargs["stdout"].flush()
            process = Mock()
            process.poll.return_value = 1
            return process

        with patch.object(dev, "read_state", return_value={}), \
             patch.object(dev, "assert_ports_free"), \
             patch.object(dev, "stop_children"), \
             patch.object(dev, "stop"), \
             patch.object(dev.subprocess, "Popen", side_effect=failed_supervisor), \
             patch.object(dev, "say") as say:
            with self.assertRaisesRegex(dev.StartupError, "Startup failed"):
                dev.start(args)
        displayed = "\n".join(call.args[0] for call in say.call_args_list)
        self.assertIn("Current missing mount error", displayed)
        self.assertNotIn("Earlier Colima", displayed)
        self.assertNotIn("旧日志", displayed)
        self.assertIn("Earlier Colima", dev.SUPERVISOR_LOG.read_text())

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
