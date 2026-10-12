import { readFile, access } from 'node:fs/promises';
import { platform, arch, release, homedir } from 'node:os';
import { join } from 'node:path';
import { dockerCheck, openBrowser, run } from './docker.js';
import { TessmoraError } from './errors.js';
import { BACK, backOption } from './ui.js';

const DOCS = {
  mac: 'https://docs.docker.com/desktop/setup/install/mac-install/',
  windows: 'https://docs.docker.com/desktop/setup/install/windows-install/',
  wsl: 'https://docs.docker.com/desktop/features/wsl/',
  linux: 'https://docs.docker.com/engine/install/',
  compose: 'https://docs.docker.com/compose/install/linux/',
  permissions: 'https://docs.docker.com/engine/install/linux-postinstall/',
  context: 'https://docs.docker.com/engine/manage-resources/contexts/',
};
const recoverable = new Set(['DOCKER_MISSING', 'DOCKER_CLI_FAILED', 'DOCKER_NOT_RUNNING', 'DOCKER_PERMISSION', 'COMPOSE_MISSING', 'COMPOSE_OUTDATED']);

export async function detectDockerHost({ os = platform(), cpu = arch(), kernel = release(), env = process.env, home = homedir(), read = readFile, exists = access } = {}) {
  const wsl = os === 'linux' && Boolean(env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(kernel));
  let distro = '';
  if (os === 'linux' && !wsl) {
    try { distro = /^ID=["']?([a-z0-9_-]+)/m.exec(await read('/etc/os-release', 'utf8'))?.[1] || ''; }
    catch { /* Unknown distributions still receive the official platform selector. */ }
  }
  let desktopPath;
  if (os === 'darwin') {
    for (const candidate of ['/Applications/Docker.app', join(home, 'Applications/Docker.app')]) {
      try { await exists(candidate); desktopPath = candidate; break; } catch { /* Not installed here. */ }
    }
  }
  const label = os === 'darwin' ? `macOS · ${cpu === 'arm64' ? 'Apple silicon' : cpu === 'x64' ? 'Intel' : cpu}`
    : wsl ? 'Windows · WSL' : os === 'win32' ? 'Windows · 建议在 WSL2 中运行' : `Linux${distro ? ` · ${distro}` : ''}`;
  return { os, cpu, wsl, distro, desktopPath, label, explicitHost: Boolean(env.DOCKER_HOST), context: /^[a-zA-Z0-9_.-]{1,80}$/.test(env.DOCKER_CONTEXT || '') ? env.DOCKER_CONTEXT : undefined };
}

export function dockerGuide(error, host) {
  const compose = error.code.startsWith('COMPOSE_');
  const context = error.details?.context || host.context;
  const customContext = host.explicitHost || Boolean(context && !['default', 'desktop-linux'].includes(context));
  let url, steps;
  if (host.os === 'win32' || host.wsl) {
    url = host.wsl ? DOCS.wsl : DOCS.windows;
    steps = [
      '确认 Windows 上已安装并启动 Docker Desktop，使用 Linux containers。',
      '在 Settings → General 启用 WSL 2 engine；在 Resources → WSL Integration 启用当前发行版。',
      host.wsl ? '确认当前发行版使用 WSL2（可在 Windows 运行 wsl -l -v），完成后回到此处重新检测。'
        : '若还没有 WSL2，在管理员 PowerShell 执行 wsl --install -d Ubuntu，按提示重启。',
      ...(!host.wsl ? ['随后在 Ubuntu / WSL2 内安装 Node.js 22.19+、获取项目源码并重新运行向导。'] : []),
      ...(compose ? ['Docker Desktop 已包含 Compose；更新 Desktop 后重新检测，并检查 WSL Integration。'] : []),
    ];
  } else if (host.os === 'darwin') {
    url = DOCS.mac;
    steps = compose ? [
      'Docker 引擎已连接。Docker Desktop 用户请更新 Desktop，其中附带 Compose。',
      '使用 Colima / 其他引擎时，单独安装 Compose；Homebrew 用户可查看 brew info docker-compose 的安装说明。',
      '运行 docker compose version 或 docker-compose version，确认版本为 2.20 或更新，再重新检测。',
    ] : error.code === 'DOCKER_PERMISSION' ? [
      '在当前终端执行 docker info，确认当前用户对所选 Docker 引擎有访问权限。',
      'Docker Desktop 用户请检查应用的首次设置是否完成；其他引擎请按其安装方式修复访问权限。',
      '完成后回到向导重新检测。',
    ] : error.code === 'DOCKER_NOT_RUNNING' ? [
      '从 Applications 打开 Docker，完成窗口中的首次设置，等待引擎显示正在运行。',
      '如果安装的是 Colima，请启动已有 Colima 环境；只有 Docker 命令行工具时，还需要安装一个容器引擎。',
      '在当前终端运行 docker info 确认连接，或选择下方的等待选项自动继续。',
    ] : [
      `在官方页面选择 ${host.cpu === 'arm64' ? 'Apple silicon' : host.cpu === 'x64' ? 'Intel chip' : '与处理器对应'} 的 Docker Desktop。`,
      '打开下载的 Docker.dmg，将 Docker 拖到 Applications，然后启动 Docker。',
      '在 Docker 窗口完成首次设置，等待引擎显示正在运行，再回到向导继续。',
      '若刚安装后命令仍找不到，可新开终端重新运行同一条 setup 命令，已有进度会保留。',
    ];
  } else {
    const supported = ['ubuntu', 'debian', 'fedora', 'centos', 'rhel', 'raspbian'].includes(host.distro);
    url = compose ? DOCS.compose : error.code === 'DOCKER_PERMISSION' ? DOCS.permissions : supported ? `${DOCS.linux}${host.distro}/` : DOCS.linux;
    steps = compose ? [
      '按官方指南为当前发行版配置 Docker 软件源并安装 Compose 插件。',
      ...(['ubuntu', 'debian', 'raspbian'].includes(host.distro) ? ['软件源配置完成后：sudo apt-get update，然后 sudo apt-get install docker-compose-plugin']
        : ['fedora', 'centos', 'rhel'].includes(host.distro) ? ['软件源配置完成后：sudo dnf install docker-compose-plugin'] : []),
      '运行 docker compose version，确认版本为 2.20 或更新。',
    ] : error.code === 'DOCKER_PERMISSION' ? [
      '按官方安装后步骤配置当前用户访问 Docker，或使用 Rootless 模式。',
      'docker 用户组拥有主机高权限；由你或管理员确认采用哪种访问方式。',
      '组权限变更后重新登录终端，运行 docker info，再继续原来的 setup 命令。',
    ] : error.code === 'DOCKER_NOT_RUNNING' ? [
      '使用 systemd 的 Docker Engine 安装，可执行 sudo systemctl start docker 启动服务。',
      'Rootless 安装使用 systemctl --user start docker；Docker Desktop 用户请启动 Desktop。',
      '用当前用户运行 docker info 确认引擎可访问，再回到向导继续。',
    ] : [
      '按官方指南选择当前 Linux 发行版，安装 Docker Engine 和 Compose 插件（2.20+）。',
      '已安装但未启动：使用 systemd 的系统可执行 sudo systemctl start docker。',
      'Rootless 安装使用 systemctl --user start docker；Docker Desktop 用户请启动 Desktop。',
      '用当前用户运行 docker info 确认引擎可访问，再回到向导继续。',
    ];
  }
  if (customContext && !['DOCKER_MISSING', 'DOCKER_CLI_FAILED'].includes(error.code)) {
    url = context?.startsWith('colima') && !host.explicitHost ? 'https://github.com/abiosoft/colima#quick-start' : DOCS.context;
    steps = [
      ...(context ? [`当前 Docker context：${context}。`] : []),
      ...(host.explicitHost ? ['当前终端设置了 DOCKER_HOST，请检查对应引擎与连接配置。'] : []),
      context?.startsWith('colima') && !host.explicitHost ? context === 'colima' ? '使用 Colima 时，执行 colima start 启动已有环境，再运行 docker info。' : '运行 colima list 找到对应配置，再使用 colima start --profile <配置名> 启动该环境。' : '运行 docker context ls 检查当前连接，确认目标引擎正在运行且当前用户可访问。',
      ...(compose ? ['当前还需要安装或升级本机 Compose 至 2.20+。', `Compose 安装说明：${DOCS.compose}`] : []),
      '确认连接后回到向导重新检测；向导会沿用当前 context。',
    ];
  }
  if (error.code === 'DOCKER_CLI_FAILED') steps.unshift('先在终端运行 docker --version，检查 Docker 程序与 PATH 是否正常。');
  return {
    title: `准备 Docker · ${host.label}`,
    url,
    steps,
    // Launch only an installed local Desktop explicitly selected by the user.
    desktopPath: host.os === 'darwin' && host.desktopPath && !customContext && !compose && error.code !== 'DOCKER_PERMISSION' ? host.desktopPath : undefined,
  };
}

export async function checkDockerWithGuidance({ check = dockerCheck, host = detectDockerHost } = {}) {
  try { return await check(); }
  catch (error) {
    if (!recoverable.has(error.code)) throw error;
    const guide = dockerGuide(error, await host());
    error.hint = [...guide.steps.map((step, i) => `${i + 1}. ${step}`), `官方说明：${guide.url}`, '完成后重新运行原来的 setup 命令；进度已保留。'].join('\n');
    throw error;
  }
}

export async function waitForDocker({ check = dockerCheck, timeout = 180000, interval = 3000, now = Date.now, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)), onWait = () => {} } = {}) {
  const deadline = now() + timeout;
  while (true) {
    if (now() >= deadline) throw new TessmoraError('DOCKER_WAIT_TIMEOUT', 'Docker 还没有就绪，配置进度已保留。', '可以继续安装或启动 Docker，再选择重新检测。');
    try { return await check(); }
    catch (error) {
      if (!['DOCKER_MISSING', 'DOCKER_NOT_RUNNING'].includes(error.code)) throw error;
      onWait(error);
    }
    await sleep(Math.min(interval, Math.max(0, deadline - now())));
  }
}

export async function prepareDocker(ui, { back = false, 'no-open': noOpen = false } = {}, {
  check = dockerCheck, host = detectDockerHost, open = openBrowser,
  launch = (path) => run('open', ['-a', path], { timeout: 10000 }),
  wait = waitForDocker,
} = {}) {
  if (!ui.interactive) return checkDockerWithGuidance({ check, host });
  while (true) {
    let error;
    try { return await check(); }
    catch (cause) { if (!recoverable.has(cause.code)) throw cause; error = cause; }
    const guide = dockerGuide(error, await host());
    ui.card(guide.title, [error.message, '', ...guide.steps.map((step, i) => `${i + 1}. ${step}`), '', guide.url, '', 'Python 和服务依赖由容器提供；Docker 就绪后会继续当前配置。']);
    const next = await ui.select('准备好后，从这里继续', [
      ...(guide.desktopPath ? [{ value: 'launch', label: '启动已安装的 Docker Desktop', hint: '打开应用，等待引擎就绪后自动继续' }] : []),
      ...(!noOpen ? [{ value: 'guide', label: '打开官方安装 / 修复指南', hint: '完成页面中的步骤，再回到终端继续' }] : []),
      { value: 'retry', label: '已完成，重新检测', hint: '通过后自动继续配置' },
      { value: 'wait', label: '等待 Docker 就绪，自动继续', hint: '每 3 秒检测，等待约 3 分钟；Ctrl+C 可退出' },
      ...(back ? [backOption] : []),
      { value: 'exit', label: '保存进度，稍后继续' },
    ], 'retry');
    if (next === BACK) return BACK;
    if (next === 'exit') throw new TessmoraError('CANCELLED', '已保存进度，安装完成后重新运行原来的 setup 命令即可继续。');
    if (next === 'guide') {
      if (!await open(guide.url)) ui.warn(`无法自动打开浏览器，请手动访问：${guide.url}`);
      continue;
    }
    if (next === 'launch') {
      try { await launch(guide.desktopPath); }
      catch { ui.warn('未能打开 Docker Desktop。请从 Applications 手动启动，然后重新检测。'); continue; }
    }
    if (next === 'launch' || next === 'wait') {
      const spin = ui.spinner('等待 Docker 就绪 · 首次启动可能需要完成 Docker 窗口内的设置');
      try {
        const result = await wait({ check, onWait: (reason) => spin.message(`${reason.message} · 正在重新检测…`) });
        spin.stop('Docker 与 Compose 已就绪，继续配置');
        return result;
      } catch (cause) {
        spin.error('等待结束，已保留配置进度');
        if (!recoverable.has(cause.code) && cause.code !== 'DOCKER_WAIT_TIMEOUT') throw cause;
        ui.warn(cause.message);
      }
    }
  }
}
