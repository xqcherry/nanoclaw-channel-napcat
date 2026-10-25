#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv.slice(2);
if (input.length !== 2 || input[0] !== "--source")
  throw new Error("Usage: npm run test:host -- --source <NanoClaw checkout>");
const source = await fs.realpath(input[1]),
  target = await fs.mkdtemp(path.join(tmpdir(), "napcat-host-"));
function run(cmd, args, cwd = target) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, NAPCAT_ENABLED: "false", WECHAT_ENABLED: "false" },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
try {
  console.log(`Integration workspace: ${target}`);
  // Copy source and build configuration only; never copy .env, runtime data or credentials.
  for (const name of [
    "src",
    "scripts",
    "setup",
    "container",
    "tsconfig.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vitest.config.ts",
  ]) {
    try {
      await fs.cp(path.join(source, name), path.join(target, name), {
        recursive: true,
        filter: (p) =>
          !["node_modules", ".env", "data", "logs", ".git", "dist"].includes(
            path.basename(p),
          ),
      });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const before = await fs.readFile(path.join(target, "src/channels/index.ts"));
  const cli = path.join(root, "scripts/channel.mjs");
  await run(process.execPath, [
    cli,
    "install",
    "--target",
    target,
    "--dry-run",
  ]);
  await run(process.execPath, [cli, "install", "--target", target]);
  await run(process.execPath, [cli, "install", "--target", target]);
  await run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  await run("pnpm", ["run", "build"]);
  await run("pnpm", [
    "exec",
    "vitest",
    "run",
    "src/channels/napcat.registration.test.ts",
  ]);
  // Delete the actual integration point and require the registration test to fail.
  const barrel = path.join(target, "src/channels/index.ts");
  const installed = await fs.readFile(barrel, "utf8");
  await fs.writeFile(barrel, installed.replace("import './napcat.js';\n", ""));
  let failed = false;
  try {
    await run("pnpm", [
      "exec",
      "vitest",
      "run",
      "src/channels/napcat.registration.test.ts",
    ]);
  } catch {
    failed = true;
  }
  if (!failed)
    throw new Error("Registration test survived removal of barrel import");
  await fs.writeFile(barrel, installed);
  await run(process.execPath, [cli, "uninstall", "--target", target]);
  if (!(await fs.readFile(barrel)).equals(before))
    throw new Error("Uninstall changed an existing barrel registration");
  await run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  await run("pnpm", ["run", "build"]);
  console.log(
    "PASS: real host install, reapply, build, barrel registration/mutation, uninstall and rebuild.",
  );
} finally {
  await fs.rm(target, { recursive: true, force: true });
}
