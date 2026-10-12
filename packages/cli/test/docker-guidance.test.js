import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerCheck, refreshDockerPath, openBrowser } from '../src/docker.js';
import { detectDockerHost, dockerGuide, checkDockerWithGuidance, prepareDocker, waitForDocker } from '../src/docker-guidance.js';
import { TessmoraError } from '../src/errors.js';
import { BACK } from '../src/ui.js';

const failure = (code, hint = '') => new TessmoraError(code, code, hint);
const missing = () => failure('DOCKER_MISSING');
const stopped = () => failure('DOCKER_NOT_RUNNING');
const ready = { version: '29.0.0', compose: '2.40.0' };
const mac = { os: 'darwin', cpu: 'arm64', label: 'macOS · Apple silicon', desktopPath: '/Applications/Docker.app' };

function runtime({ clientError, daemonError, plugin = 'v2.40.0', standalone, context = 'default' } = {}) {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '--version') { if (clientError) throw clientError; return 'Docker version 29.0.0'; }
    if (args[0] === 'context') return context;
    if (args[0] === 'compose' || command === 'docker-compose') {
      const value = command === 'docker-compose' ? standalone : plugin;
      if (!value) throw failure('COMMAND_MISSING');
      return value;
    }
    if (args[0] === 'version') { if (daemonError) throw daemonError; return '29.0.0'; }
    if (args[0] === 'info') return '{"memoryBytes":4294967296,"cpus":2}';
    assert.fail(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { runner, calls };
}

for (const [label, options, code] of [
  ['missing CLI', { clientError: failure('COMMAND_MISSING') }, 'DOCKER_MISSING'],
  ['broken CLI', { clientError: failure('COMMAND_FAILED') }, 'DOCKER_CLI_FAILED'],
  ['stopped engine', { daemonError: failure('COMMAND_FAILED', 'Cannot connect to daemon') }, 'DOCKER_NOT_RUNNING'],
  ['socket permission', { daemonError: failure('COMMAND_FAILED', 'permission denied while connecting') }, 'DOCKER_PERMISSION'],
  ['missing Compose', { plugin: null }, 'COMPOSE_MISSING'],
  ['legacy Compose', { plugin: null, standalone: '1.29.2' }, 'COMPOSE_OUTDATED'],
  ['old plugin', { plugin: '2.19.9' }, 'COMPOSE_OUTDATED'],
]) test(`Docker diagnostics distinguish ${label}`, async () => {
  await assert.rejects(dockerCheck(runtime(options)), { code });
});

test('Compose probe accepts minimum and later versions and falls back to a supported standalone binary', async () => {
  for (const plugin of ['2.20.0', 'v2.40.0', '5.1.0']) assert.equal((await dockerCheck(runtime({ plugin }))).compose, plugin);
  const probe = runtime({ plugin: '2.19.9', standalone: '2.40.1' });
  const result = await dockerCheck(probe);
  assert.equal(result.compose, '2.40.1');
  assert.ok(result.advisory.includes('8 GiB'));
  assert.ok(probe.calls.some(([command]) => command === 'docker-compose'));
  assert.ok(probe.calls.every(([, action]) => ['--version', 'context', 'version', 'compose', 'info'].includes(action)));
});

test('host discovery identifies WSL and Linux distribution without executing host commands', async () => {
  const wsl = await detectDockerHost({ os: 'linux', cpu: 'x64', kernel: '5.15-microsoft-standard-WSL2', env: {}, read: () => assert.fail('WSL uses Windows instructions') });
  assert.equal(wsl.wsl, true);
  assert.match(wsl.label, /WSL/);
  const linux = await detectDockerHost({ os: 'linux', kernel: '6.1', env: {}, read: async () => 'NAME="Ubuntu"\nID=ubuntu\n' });
  assert.equal(linux.distro, 'ubuntu');
  assert.match(dockerGuide(missing(), linux).url, /engine\/install\/ubuntu\/$/);
  const detectedMac = await detectDockerHost({ os: 'darwin', cpu: 'x64', env: {}, exists: async path => { assert.equal(path, '/Applications/Docker.app'); } });
  assert.match(detectedMac.label, /Intel/);
  assert.equal(detectedMac.desktopPath, '/Applications/Docker.app');
});

test('guides match Mac architecture, WSL integration, Windows entry and Linux permissions', () => {
  assert.match(dockerGuide(missing(), mac).steps.join('\n'), /Apple silicon/);
  assert.match(dockerGuide(missing(), { ...mac, cpu: 'x64' }).steps.join('\n'), /Intel chip/);
  assert.match(dockerGuide(missing(), { os: 'linux', wsl: true }).steps.join('\n'), /WSL Integration/);
  assert.match(dockerGuide(missing(), { os: 'win32' }).steps.join('\n'), /wsl --install -d Ubuntu/);
  const permissions = dockerGuide(failure('DOCKER_PERMISSION'), { os: 'linux', distro: 'debian' });
  assert.match(permissions.url, /linux-postinstall/);
  assert.match(permissions.steps.join('\n'), /重新登录/);
  assert.match(dockerGuide(failure('COMPOSE_MISSING'), { os: 'linux', distro: 'ubuntu' }).steps.join('\n'), /docker-compose-plugin/);
  assert.ok(!dockerGuide(stopped(), mac).steps.join('\n').includes('下载的 Docker.dmg'), 'stopped engines should get startup instructions first');
  assert.match(dockerGuide(stopped(), { os: 'linux', distro: 'ubuntu' }).steps[0], /systemctl start/);
});

test('WSL opens help in the Windows browser when wslview is unavailable, with a text fallback', async () => {
  const calls = [];
  const url = 'https://docs.docker.com/desktop/features/wsl/';
  assert.equal(await openBrowser(url, { platform: 'linux', wsl: true, runner: async (command, args) => {
    calls.push([command, args]);
    if (command === 'wslview') throw failure('COMMAND_MISSING');
  } }), true);
  assert.deepEqual(calls, [['wslview', [url]], ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]]);
  assert.equal(await openBrowser(url, { platform: 'linux', wsl: true, runner: async () => { throw failure('COMMAND_MISSING'); } }), false);
});

test('Colima and explicit remote targets retain their connection and do not offer Desktop launch', () => {
  const error = stopped(); error.details = { context: 'colima' };
  const colima = dockerGuide(error, mac);
  assert.equal(colima.desktopPath, undefined);
  assert.match(colima.steps.join('\n'), /colima start/);
  const remote = dockerGuide(stopped(), { ...mac, explicitHost: true });
  assert.equal(remote.desktopPath, undefined);
  assert.match(remote.steps.join('\n'), /DOCKER_HOST/);
  const envContext = dockerGuide(stopped(), { ...mac, context: 'remote-work' });
  assert.equal(envContext.desktopPath, undefined);
  assert.match(envContext.steps.join('\n'), /remote-work/);
  assert.match(dockerGuide(missing(), { ...mac, explicitHost: true }).steps.join('\n'), /Docker.dmg/);
});

test('fresh Desktop CLI path becomes available to the current process without changing existing command precedence', async () => {
  const env = { PATH: '/custom/bin:/usr/bin' };
  const accessible = async path => { if (path !== '/Users/new/.docker/bin/docker') throw new Error('missing'); };
  assert.equal(await refreshDockerPath({ platform: 'darwin', home: '/Users/new', env, accessible }), true);
  assert.equal(env.PATH, '/custom/bin:/usr/bin:/Users/new/.docker/bin');
  assert.equal(await refreshDockerPath({ platform: 'darwin', home: '/Users/new', env, accessible }), false, 'do not loop forever on a broken binary already on PATH');
  assert.equal(await refreshDockerPath({ platform: 'linux', env, accessible: () => assert.fail('platform-specific path') }), false);
});

test('noninteractive guidance contains actionable platform steps and official URL', async () => {
  await assert.rejects(checkDockerWithGuidance({ check: async () => { throw missing(); }, host: async () => mac }), error => {
    assert.equal(error.code, 'DOCKER_MISSING');
    assert.match(error.hint, /https:\/\/docs.docker.com\//);
    assert.match(error.hint, /Apple silicon/);
    return true;
  });
  await assert.rejects(prepareDocker({ interactive: false }, {}, {
    check: async () => { throw missing(); }, host: async () => mac,
    open: () => assert.fail('no browser in automation'), launch: () => assert.fail('no Desktop in automation'),
  }), { code: 'DOCKER_MISSING' });
});

function uiFixture(actions) {
  const events = [];
  return {
    events, interactive: true,
    card: (...value) => events.push(['card', ...value]),
    warn: value => events.push(['warn', value]),
    select: async (_message, options) => {
      const action = actions.shift();
      assert.ok(options.some(option => option.value === action), `Action ${action} must be available`);
      events.push(['select', options]);
      return action;
    },
    spinner: () => ({ message() {}, stop: () => events.push(['ready']), error: () => events.push(['waiting-stopped']) }),
  };
}

test('opening installation help then retrying continues immediately when the engine becomes ready', async () => {
  const ui = uiFixture(['guide', 'retry']);
  let checks = 0;
  const opened = [];
  const result = await prepareDocker(ui, {}, {
    check: async () => { if (++checks < 3) throw missing(); return ready; },
    host: async () => ({ ...mac, desktopPath: undefined }),
    open: async url => { opened.push(url); return false; },
  });
  assert.deepEqual(result, ready);
  assert.match(opened[0], /docs.docker.com/);
  assert.ok(ui.events.some(([kind, text]) => kind === 'warn' && text.includes('手动访问')));
});

test('Desktop is launched only by the selected action and success waits for a healthy engine', async () => {
  const ui = uiFixture(['launch']);
  const launches = [];
  const result = await prepareDocker(ui, {}, {
    check: async () => { throw stopped(); }, host: async () => mac,
    launch: async path => launches.push(path),
    wait: async () => { assert.equal(launches.length, 1); return ready; },
  });
  assert.deepEqual(launches, ['/Applications/Docker.app']);
  assert.deepEqual(result, ready);
  assert.ok(ui.events.some(([kind]) => kind === 'ready'));
});

test('headless setup preserves back and saved-exit actions without opening a browser', async () => {
  const ui = uiFixture([BACK]);
  const deps = { check: async () => { throw missing(); }, host: async () => mac, open: () => assert.fail('no-open') };
  assert.equal(await prepareDocker(ui, { back: true, 'no-open': true }, deps), BACK);
  const options = ui.events.find(([kind]) => kind === 'select')[1];
  assert.ok(!options.some(option => option.value === 'guide'));
  await assert.rejects(prepareDocker(uiFixture(['exit']), {}, deps), { code: 'CANCELLED' });
});

test('waiting is sequential, retries installation/startup, and surfaces actionable failures immediately', async () => {
  let time = 0, calls = 0;
  assert.deepEqual(await waitForDocker({
    check: async () => { calls++; if (calls === 1) throw missing(); if (calls === 2) throw stopped(); return ready; },
    now: () => time, sleep: async ms => { time += ms; }, interval: 10, timeout: 100,
  }), ready);
  assert.equal(calls, 3);
  assert.equal(time, 20);
  await assert.rejects(waitForDocker({ check: async () => { throw failure('DOCKER_PERMISSION'); }, sleep: () => assert.fail('cannot recover permission by waiting') }), { code: 'DOCKER_PERMISSION' });
  await assert.rejects(waitForDocker({ check: async () => { throw stopped(); }, now: () => time, sleep: async ms => { time += ms; }, interval: 10, timeout: 20 }), { code: 'DOCKER_WAIT_TIMEOUT' });
});

test('wait timeout returns to choices and can retry without restarting the wizard', async () => {
  const ui = uiFixture(['wait', 'retry']);
  let checks = 0;
  const result = await prepareDocker(ui, {}, {
    check: async () => { if (++checks < 3) throw stopped(); return ready; }, host: async () => mac,
    wait: async () => { throw failure('DOCKER_WAIT_TIMEOUT'); },
  });
  assert.deepEqual(result, ready);
  assert.ok(ui.events.some(([kind]) => kind === 'waiting-stopped'));
});
