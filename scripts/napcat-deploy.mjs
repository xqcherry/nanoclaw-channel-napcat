import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

export const defaultImage = 'mlikiowa/napcat-docker:latest';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

export async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Port ${port} is occupied; reconcile the listener before setup`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

export async function assertAdapterPort(target, port, enabled) {
  try { await assertPortFree(port); return; }
  catch (error) {
    if (!enabled) throw error;
    // Existing listeners are allowed only when their process belongs to this host.
    const sockets = spawnSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' });
    const pids = [...(sockets.stdout ?? '').matchAll(/pid=(\d+)/g)].map(match => match[1]);
    if (sockets.status !== 0 || !pids.length) throw error;
    const root = await fs.realpath(target);
    for (const pid of pids) {
      const cwd = await fs.realpath(`/proc/${pid}/cwd`).catch(() => '');
      const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
      if (cwd !== root || !args.some(arg => ['dist/index.js', 'src/index.ts'].some(entry => arg === entry || arg === path.join(root, entry)))) throw error;
    }
  }
}

export async function verifyWebUI(token, url = 'http://127.0.0.1:6099/api/auth/login') {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash: sha(token + '.napcat') }), signal: AbortSignal.timeout(1500),
  });
  const result = await response.json();
  return response.ok && result.code === 0 && typeof result.data?.Credential === 'string' && result.data.Credential.length > 0;
}

export async function checkedPath(target, relative) {
  const root = await fs.realpath(target);
  let current = root;
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Unsafe deployment path');
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Conflict: symlink ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

async function optional(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function privateWrite(file, value) {
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, value, { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function readHostConfig(target) {
  const text = await optional(await checkedPath(target, '.env')) ?? '';
  const result = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(NAPCAT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

export async function writeHostConfig(target, values) {
  const file = await checkedPath(target, '.env');
  const previous = await optional(file) ?? '';
  const lines = previous.split('\n').filter(line => !Object.keys(values).some(key => new RegExp(`^\\s*${key}\\s*=`).test(line)));
  while (lines.at(-1) === '') lines.pop();
  for (const [key, value] of Object.entries(values)) {
    if (!/^NAPCAT_[A-Z_]+$/.test(key) || /[\r\n]/.test(value)) throw new Error('Invalid host configuration');
    lines.push(`${key}=${value}`);
  }
  await privateWrite(file, lines.join('\n') + '\n');
}

export async function prepareDeployment({ target, image, selfId }) {
  if (selfId && !/^[1-9]\d{4,15}$/.test(selfId)) throw new Error('Invalid robot QQ number');
  const directory = await checkedPath(target, 'data/napcat');
  const stateFile = await checkedPath(target, 'data/napcat/setup-state.json');
  const existing = await optional(stateFile);
  let state = existing ? JSON.parse(existing) : null;
  if (!state) {
    const files = await fs.readdir(directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (files.length) throw new Error('Conflict: unmanaged data/napcat directory');
    state = {
      version: 1,
      project: `nanoclaw-napcat-${sha(await fs.realpath(target)).slice(0, 10)}`,
      accessToken: randomBytes(32).toString('hex'),
      webuiToken: randomBytes(32).toString('hex'),
      image: image ?? defaultImage,
    };
  } else if (state.version !== 1 || !/^[a-f0-9]{64}$/.test(state.accessToken) || !/^[a-f0-9]{64}$/.test(state.webuiToken)) {
    throw new Error('Conflict: invalid deployment state');
  }
  if (image && existing && image !== state.image) throw new Error('Conflict: deployment already pins a different image');
  const compose = `name: ${state.project}\nservices:\n  napcat:\n    image: ${JSON.stringify(state.image)}\n    restart: unless-stopped\n    network_mode: host\n    environment:\n      NAPCAT_UID: "${process.getuid?.() ?? 1000}"\n      NAPCAT_GID: "${process.getgid?.() ?? 1000}"\n    volumes:\n      - ./config:/app/napcat/config\n      - ./qq:/app/.config/QQ\n      - ./plugins:/app/napcat/plugins\n`;
  const composeFile = await checkedPath(target, 'data/napcat/compose.yaml');
  const priorCompose = await optional(composeFile);
  if (existing && (priorCompose ? sha(priorCompose) !== state.composeHash : !state.initializing)) throw new Error('Conflict: modified managed compose.yaml');
  if (!existing) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    state.initializing = true;
    state.composeHash = sha(compose);
    // Write the ownership journal before any runtime file: interrupted setup is resumable.
    await privateWrite(stateFile, json(state));
  }
  for (const dir of ['config', 'qq', 'plugins']) await fs.mkdir(await checkedPath(target, `data/napcat/${dir}`), { recursive: true, mode: 0o700 });
  const webuiFile = await checkedPath(target, 'data/napcat/config/webui.json');
  const onebotFile = await checkedPath(target, 'data/napcat/config/onebot11.json');
  if (!(await optional(webuiFile))) await privateWrite(webuiFile, json({ host: '127.0.0.1', port: 6099, prefix: '', token: state.webuiToken, loginRate: 3 }));
  if (!(await optional(onebotFile))) await privateWrite(onebotFile, json({
    network: {
      httpServers: [], httpSseServers: [], httpClients: [], websocketServers: [],
      websocketClients: [{ enable: true, name: 'nanoclaw', url: 'ws://127.0.0.1:3002/onebot/v11/ws', reportSelfMessage: false, messagePostFormat: 'array', token: state.accessToken, debug: false, heartInterval: 30000, reconnectInterval: 5000 }],
      plugins: [],
    }, musicSignUrl: '', enableLocalFile2Url: false, parseMultMsg: false,
  }));
  const webui = JSON.parse(await fs.readFile(webuiFile, 'utf8'));
  const onebot = JSON.parse(await fs.readFile(onebotFile, 'utf8'));
  const client = onebot.network?.websocketClients?.find(client => client.name === 'nanoclaw');
  if (webui.host !== '127.0.0.1' || webui.port !== 6099 || webui.token !== state.webuiToken || client?.token !== state.accessToken || client?.url !== 'ws://127.0.0.1:3002/onebot/v11/ws' || !client.enable || client.messagePostFormat !== 'array') {
    throw new Error('Conflict: managed connection settings changed; reconcile in WebUI before setup');
  }
  // NapCat may prefer an account-specific config after login. Never replace it.
  if (selfId) {
    const accountFile = await checkedPath(target, `data/napcat/config/onebot11_${selfId}.json`);
    const account = await optional(accountFile);
    if (account) {
      const c = JSON.parse(account).network?.websocketClients?.find(c => c.name === 'nanoclaw');
      if (!c?.enable || c.token !== state.accessToken || c.url !== client.url || c.messagePostFormat !== 'array') throw new Error('Conflict: account-specific OneBot settings differ; reconcile in WebUI');
    } else await privateWrite(accountFile, json(onebot));
  }
  if (!priorCompose) await privateWrite(composeFile, compose);
  state.composeHash = sha(priorCompose ?? compose);
  state.initializing = false;
  await privateWrite(stateFile, json(state));
  return { ...state, directory };
}
