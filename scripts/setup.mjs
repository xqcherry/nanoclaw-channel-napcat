#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareDeployment, readHostConfig, writeHostConfig, defaultImage, checkedPath, assertPortFree, assertAdapterPort, verifyWebUI } from './napcat-deploy.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let setupLock, setupLockFile;
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed${capture ? `: ${result.stderr.trim()}` : ''}`);
  return capture ? result.stdout.trim() : '';
}

function options(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (['--dry-run', '--external-napcat', '--help'].includes(name)) opts[name.slice(2)] = true;
    else if (['--target', '--self-id', '--user-qq', '--agent', '--service'].includes(name) && args[i + 1] && !args[i + 1].startsWith('--')) opts[name.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${name}`);
  }
  if (opts.help) return opts;
  if (!opts.target) throw new Error('Explicit --target is required');
  for (const key of ['self-id', 'user-qq']) if (opts[key] && !/^[1-9]\d{4,15}$/.test(opts[key])) throw new Error(`Invalid --${key}`);
  if (Boolean(opts['user-qq']) !== Boolean(opts.agent)) throw new Error('--user-qq and --agent must be supplied together');
  if (opts.service && !/^[\w@.-]+\.service$/.test(opts.service)) throw new Error('--service must name a systemd user .service unit');
  return opts;
}

function ncl(target, args) {
  const response = JSON.parse(run(path.join(target, 'bin/ncl'), [...args, '--json'], target, true));
  if (response.ok === false) throw new Error(`ncl ${args[0]} ${args[1]} rejected the operation`);
  return response.data ?? response;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  throw new Error('Unexpected ncl list result');
}

async function bind(target, userQQ, folder) {
  const groups = rows(ncl(target, ['groups', 'list']));
  const group = groups.find(g => g.folder === folder || g.id === folder);
  if (!group) throw new Error(`Agent group not found: ${folder}`);
  const userId = `qq:${userQQ}`, platformId = `private:${userQQ}`;
  if (!rows(ncl(target, ['users', 'list'])).some(u => u.id === userId)) ncl(target, ['users', 'create', '--id', userId, '--kind', 'qq', '--display-name', 'QQ user']);
  if (!rows(ncl(target, ['members', 'list', '--group', group.id])).some(m => m.user_id === userId)) ncl(target, ['members', 'add', '--user', userId, '--group', group.id]);
  if (!rows(ncl(target, ['messaging-groups', 'list'])).some(g => g.channel_type === 'qq' && g.platform_id === platformId)) ncl(target, ['messaging-groups', 'create', '--channel-type', 'qq', '--platform-id', platformId, '--name', 'QQ private chat', '--is-group', '0', '--unknown-sender-policy', 'strict']);
  const existing = rows(ncl(target, ['wirings', 'list']));
  const chats = rows(ncl(target, ['messaging-groups', 'list']));
  const chat = chats.find(g => g.channel_type === 'qq' && g.platform_id === platformId);
  if (!existing.some(w => w.messaging_group_id === chat.id && w.agent_group_id === group.id)) ncl(target, ['wirings', 'create', '--channel-type', 'qq', '--platform-id', platformId, '--agent-group', group.folder, '--sender-scope', 'known', '--engage-mode', 'pattern', '--engage-pattern', '.', '--threads', '0', '--session-mode', 'shared']);
  console.log(`Bound ${userId} to ${group.folder} with member access.`);
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: npm run setup -- --target <NanoClaw> [--self-id QQ] [--user-qq QQ --agent FOLDER] [--service UNIT.service] [--external-napcat] [--dry-run]');
    return;
  }
  const target = await fs.realpath(path.resolve(opts.target));
  if (opts['dry-run']) {
    console.log(`Plan: install QQ channel, frozen host dependencies and build in ${target}; ${opts['external-napcat'] ? 'reuse external NapCat' : 'deploy Docker NapCat with private WebUI and persistent login'}; enable only with robot QQ; bind only when requested; restart only with --service.`);
    return;
  }
  if (!opts['external-napcat'] && process.platform !== 'linux') throw new Error('Automatic Docker deployment currently requires Linux; use --external-napcat on other platforms');
  setupLockFile = await checkedPath(target, '.napcat-setup.lock');
  setupLock = await fs.open(setupLockFile, 'wx').catch(() => { throw new Error('Setup lock exists; confirm no setup is running before removing .napcat-setup.lock'); });
  // Preflight the source installer before downloads or deployment writes.
  run(process.execPath, [path.join(source, 'scripts/channel.mjs'), 'install', '--target', target, '--dry-run'], source);
  const current = await readHostConfig(target);
  const selfId = opts['self-id'] ?? current.NAPCAT_SELF_ID;
  if (opts['user-qq'] && !selfId) throw new Error('--self-id is required before binding');
  let deployment;
  if (!opts['external-napcat']) {
    run('docker', ['compose', 'version'], target);
    run('docker', ['info', '--format', '{{.ServerVersion}}'], target);
    const statePath = await checkedPath(target, 'data/napcat/setup-state.json');
    let image;
    try { await fs.access(statePath); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      run('docker', ['pull', defaultImage], target);
      const digests = JSON.parse(run('docker', ['image', 'inspect', defaultImage, '--format', '{{json .RepoDigests}}'], target, true));
      image = digests.find(digest => digest.startsWith('mlikiowa/napcat-docker@sha256:'));
      if (!image) throw new Error('Cannot pin downloaded NapCat image digest');
    }
    deployment = await prepareDeployment({ target, image, selfId });
  } else if (!selfId || !current.NAPCAT_ACCESS_TOKEN) throw new Error('External NapCat requires NAPCAT_ACCESS_TOKEN in the host .env and --self-id');
  // Commit host configuration only after dependency/build/deployment/binding success.
  const hostValues = {
    NAPCAT_ENABLED: selfId ? 'true' : 'false',
    NAPCAT_HOST: deployment ? '127.0.0.1' : (current.NAPCAT_HOST ?? '127.0.0.1'),
    NAPCAT_PORT: deployment ? '3002' : (current.NAPCAT_PORT ?? '3002'),
    NAPCAT_PATH: deployment ? '/onebot/v11/ws' : (current.NAPCAT_PATH ?? '/onebot/v11/ws'),
    NAPCAT_ACCESS_TOKEN: deployment?.accessToken ?? current.NAPCAT_ACCESS_TOKEN,
    ...(selfId ? { NAPCAT_SELF_ID: selfId } : {}),
  };
  run(process.execPath, [path.join(source, 'scripts/channel.mjs'), 'install', '--target', target], source);
  const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
  const manager = pkg.packageManager?.startsWith('pnpm@') ? 'pnpm' : 'npm';
  run(manager, manager === 'pnpm' ? ['install', '--frozen-lockfile', '--ignore-scripts'] : ['ci', '--ignore-scripts'], target);
  run(manager, ['run', 'build'], target);
  if (deployment) {
    const composeArgs = ['compose', '-f', path.join(deployment.directory, 'compose.yaml')];
    const existingId = run('docker', [...composeArgs, 'ps', '-q', 'napcat'], target, true);
    if (!existingId) await assertPortFree(6099);
    // An enabled running QQ adapter may already own 3002. Any other listener is a conflict.
    await assertAdapterPort(target, 3002, current.NAPCAT_ENABLED === 'true');
    run('docker', [...composeArgs, 'up', '-d'], target);
    const containerId = run('docker', [...composeArgs, 'ps', '-q', 'napcat'], target, true);
    if (!containerId) throw new Error('Managed NapCat container is not running');
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        if (await verifyWebUI(deployment.webuiToken) && run('docker', ['inspect', containerId, '--format', '{{.State.Running}}'], target, true) === 'true') { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!ready) throw new Error(`NapCat WebUI not ready. Inspect Docker logs using compose file ${path.join(deployment.directory, 'compose.yaml')}; QQ channel remains disabled.`);
    console.log(`NapCat login: http://127.0.0.1:6099/webui/\nWebUI token is stored locally in ${path.join(deployment.directory, 'config/webui.json')} (token field).`);
  }
  if (opts['user-qq']) await bind(target, opts['user-qq'], opts.agent);
  await writeHostConfig(target, hostValues);
  if (opts.service) {
    run('systemctl', ['--user', 'restart', opts.service], target);
    run('systemctl', ['--user', 'is-active', opts.service], target);
  }
  console.log(selfId ? 'QQ configuration is ready; a verified NapCat connection is still required for online status.' : 'Login-only installation ready. Scan the QR code, then rerun setup with --self-id <robot QQ> and optionally --user-qq <your QQ> --agent <folder> --service <unit.service>. QQ remains disabled until then.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (setupLock) {
    await setupLock.close();
    await fs.rm(setupLockFile, { force: true });
  }
});
