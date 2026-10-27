import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const modulePath = path.resolve('scripts/napcat-deploy.mjs');
const cli = path.resolve('scripts/setup.mjs');
async function fixture(t: any) {
  const target = await mkdtemp(path.join(tmpdir(), 'napcat-deploy-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await writeFile(path.join(target, '.env'), 'WECHAT_ENABLED=true\nOTHER_VALUE=keep-me\n');
  return target;
}
async function deployModule() {
  // Dynamic import keeps missing implementation a deliberate test failure.
  try { return await import(modulePath); }
  catch { assert.fail('NapCat deployment module must exist'); }
}

test('first deployment prepares private login and reverse WS; repeat keeps secrets and QQ data', async t => {
  const target = await fixture(t);
  const { prepareDeployment, writeHostConfig } = await deployModule();
  const first = await prepareDeployment({ target, image: 'mlikiowa/napcat-docker@sha256:' + 'a'.repeat(64) });
  const config = JSON.parse(await readFile(path.join(first.directory, 'config/onebot11.json'), 'utf8'));
  assert.equal(config.network.websocketClients[0].url, 'ws://127.0.0.1:3002/onebot/v11/ws');
  assert.equal(config.network.websocketClients[0].messagePostFormat, 'array');
  assert.equal(config.network.websocketClients[0].token, first.accessToken);
  assert.equal(JSON.parse(await readFile(path.join(first.directory, 'config/webui.json'), 'utf8')).host, '127.0.0.1');
  assert.match(await readFile(path.join(first.directory, 'compose.yaml'), 'utf8'), /network_mode: host/);
  await writeFile(path.join(first.directory, 'qq/session'), 'saved login');
  await writeHostConfig(target, { NAPCAT_ENABLED: 'false', NAPCAT_ACCESS_TOKEN: first.accessToken });
  assert.match(await readFile(path.join(target, '.env'), 'utf8'), /WECHAT_ENABLED=true\nOTHER_VALUE=keep-me\n/);
  const again = await prepareDeployment({ target });
  assert.equal(again.accessToken, first.accessToken);
  assert.equal(again.webuiToken, first.webuiToken);
  assert.equal(await readFile(path.join(first.directory, 'qq/session'), 'utf8'), 'saved login');
  assert.equal((await stat(path.join(first.directory, 'setup-state.json'))).mode & 0o777, 0o600);
});

test('deployment refuses unmanaged runtime and symlink destinations', async t => {
  const target = await fixture(t);
  const { prepareDeployment } = await deployModule();
  const directory = path.join(target, 'data/napcat');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'compose.yaml'), 'user data');
  await assert.rejects(prepareDeployment({ target }), /unmanaged|Conflict/i);
  assert.equal(await readFile(path.join(directory, 'compose.yaml'), 'utf8'), 'user data');
  const another = await fixture(t);
  await symlink(target, path.join(another, 'data'));
  await assert.rejects(prepareDeployment({ target: another }), /symlink/i);
});

test('modified managed compose is not overwritten', async t => {
  const target = await fixture(t);
  const { prepareDeployment } = await deployModule();
  const result = await prepareDeployment({ target });
  await writeFile(path.join(result.directory, 'compose.yaml'), 'manual changes');
  await assert.rejects(prepareDeployment({ target }), /modified|Conflict/i);
});

test('interrupted first deployment resumes without replacing secrets', async t => {
  const target = await fixture(t);
  const { prepareDeployment } = await deployModule();
  const first = await prepareDeployment({ target });
  const stateFile = path.join(first.directory, 'setup-state.json');
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  state.initializing = true;
  await writeFile(stateFile, JSON.stringify(state));
  await rm(path.join(first.directory, 'compose.yaml'));
  const recovered = await prepareDeployment({ target });
  assert.equal(recovered.accessToken, first.accessToken);
  assert.match(await readFile(path.join(first.directory, 'compose.yaml'), 'utf8'), /network_mode: host/);
});

test('port preflight rejects an occupied port', async t => {
  const { assertPortFree } = await deployModule();
  assert.equal(typeof assertPortFree, 'function', 'port preflight must exist');
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address() as { port: number };
  await assert.rejects(assertPortFree(address.port), /port|occupied/i);
});

test('setup leaves existing environment unchanged if dependency installation fails', async t => {
  const target = await fixture(t);
  await mkdir(path.join(target, 'src/channels'), { recursive: true });
  await writeFile(path.join(target, 'src/channels/adapter.ts'), await readFile('tests/host/channels/adapter.ts'));
  for (const [file, name] of [['src/channels/channel-registry.ts', 'registerChannelAdapter'], ['src/channels/question-render-registry.ts', 'resolveQuestionRender'], ['src/env.ts', 'readEnvFile']]) {
    await writeFile(path.join(target, file), `export function ${name}() {}`);
  }
  await writeFile(path.join(target, 'src/channels/index.ts'), "import './wechat.js';\n");
  await writeFile(path.join(target, 'package.json'), JSON.stringify({ dependencies: { ws: '8.22.0' }, devDependencies: { '@types/ws': '8.18.2' } }));
  const fakeBin = path.join(target, 'fake-bin');
  await mkdir(fakeBin);
  await writeFile(path.join(fakeBin, 'npm'), '#!/bin/sh\nexit 43\n', { mode: 0o755 });
  await writeFile(path.join(target, '.env'), 'WECHAT_ENABLED=true\nNAPCAT_ENABLED=true\nNAPCAT_ACCESS_TOKEN=existing\n');
  const before = await readFile(path.join(target, '.env'), 'utf8');
  const result = spawnSync(process.execPath, [cli, '--target', target, '--external-napcat', '--self-id', '123456789'], { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm failed/);
  assert.equal(await readFile(path.join(target, '.env'), 'utf8'), before);
});

test('setup dry-run is read only and incomplete binding arguments are rejected', async t => {
  const target = await fixture(t);
  const result = spawnSync(process.execPath, [cli, '--target', target, '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Docker|NapCat/);
  await assert.rejects(stat(path.join(target, 'data')));
  const invalid = spawnSync(process.execPath, [cli, '--target', target, '--user-qq', '12345'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /agent/);
  await assert.rejects(stat(path.join(target, 'data')));
});
