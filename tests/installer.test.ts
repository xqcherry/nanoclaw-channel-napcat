import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const cli = path.resolve("scripts/channel.mjs");
async function target(t: any) {
  const dir = await mkdtemp(path.join(tmpdir(), "napcat-install-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "src/channels"), { recursive: true });
  await writeFile(
    path.join(dir, "src/channels/adapter.ts"),
    await readFile("tests/host/channels/adapter.ts"),
  );
  await writeFile(
    path.join(dir, "src/channels/channel-registry.ts"),
    "export function registerChannelAdapter() {}",
  );
  await writeFile(
    path.join(dir, "src/channels/question-render-registry.ts"),
    "export function resolveQuestionRender() {}",
  );
  await writeFile(
    path.join(dir, "src/env.ts"),
    "export function readEnvFile() {}",
  );
  await writeFile(
    path.join(dir, "src/channels/index.ts"),
    "import './wechat.js';\n",
  );
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      dependencies: { ws: "8.22.0" },
      devDependencies: { "@types/ws": "8.18.2" },
    }),
  );
  return dir;
}
function run(command: string, dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, command, "--target", dir, ...args], {
    encoding: "utf8",
  });
}

test("dry-run is read-only; install/reinstall/uninstall retain existing channel and shared dependencies", async (t) => {
  const dir = await target(t),
    barrel = path.join(dir, "src/channels/index.ts");
  let r = run("install", dir, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  await assert.rejects(access(path.join(dir, "src/channels/napcat.ts")));
  r = run("install", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(barrel, "utf8"), /napcat/);
  r = run("install", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    (await readFile(barrel, "utf8")).match(/import '.\/napcat.js';/g)?.length,
    1,
  );
  r = run("uninstall", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(barrel, "utf8"), "import './wechat.js';\n");
  await assert.rejects(access(path.join(dir, "src/channels/napcat.ts")));
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
      .dependencies.ws,
    "8.22.0",
  );
  assert.equal(run("uninstall", dir).status, 0);
});
test("conflicts and incompatible host stop before changing any files", async (t) => {
  const dir = await target(t);
  await writeFile(path.join(dir, "src/channels/napcat.ts"), "user file");
  let r = run("install", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /conflict/i);
  assert.equal(
    await readFile(path.join(dir, "src/channels/napcat.ts"), "utf8"),
    "user file",
  );
  await rm(path.join(dir, "src/channels/napcat.ts"));
  await writeFile(
    path.join(dir, "src/channels/adapter.ts"),
    "export interface ChannelAdapter { changed: true }",
  );
  r = run("install", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /incompatible/i);
  await assert.rejects(access(path.join(dir, "src/channels/napcat.ts")));
});
test("modified managed files block reinstall and removal; dry-run also detects conflicts", async (t) => {
  const dir = await target(t);
  assert.equal(run("install", dir).status, 0);
  const file = path.join(dir, "src/channels/napcat/adapter.ts");
  await writeFile(file, "user changes");
  for (const command of ["install", "uninstall"])
    for (const args of [[], ["--dry-run"]]) {
      const r = run(command, dir, ...args);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /conflict/i);
    }
  assert.equal(await readFile(file, "utf8"), "user changes");
});

test("requires explicit target and rejects symlink destinations without touching referent", async (t) => {
  const noTarget = spawnSync(process.execPath, [cli, "install"], {
    encoding: "utf8",
  });
  assert.notEqual(noTarget.status, 0);
  assert.match(noTarget.stderr, /--target/);
  const dir = await target(t);
  const outside = await mkdtemp(path.join(tmpdir(), "napcat-referent-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const { symlink } = await import("node:fs/promises");
  await symlink(outside, path.join(dir, "src/channels/napcat"));
  const r = run("install", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /symlink/);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(outside), []);
});
test("refuses changed registration and preserves unrelated new files on uninstall", async (t) => {
  const dir = await target(t);
  assert.equal(run("install", dir).status, 0);
  await writeFile(path.join(dir, "src/channels/napcat/user-note.txt"), "keep");
  const barrel = path.join(dir, "src/channels/index.ts"),
    before = await readFile(barrel, "utf8");
  await writeFile(
    barrel,
    before.replace("import './napcat.js';", "import './napcat.js'; // custom"),
  );
  let r = run("uninstall", dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /conflict/i);
  await writeFile(barrel, before);
  r = run("uninstall", dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    await readFile(path.join(dir, "src/channels/napcat/user-note.txt"), "utf8"),
    "keep",
  );
});
