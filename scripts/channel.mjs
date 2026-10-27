#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = ".claude/skills/add-napcat/install-state.json";
const importLine = "import './napcat.js';\n";
const pins = [
  ["dependencies", "ws", "8.22.0"],
  ["devDependencies", "@types/ws", "8.18.2"],
];
const entries = [
  ["src/channels/napcat.ts", "src/channels/napcat.ts"],
  ...["adapter", "connection", "messages"].map((n) => [
    `src/channels/napcat/${n}.ts`,
    `src/channels/napcat/${n}.ts`,
  ]),
  [
    "src/channels/napcat.registration.test.ts",
    "src/channels/napcat.registration.test.ts",
  ],
  ...["SKILL.md", "REMOVE.md"].map((n) => [
    `skills/add-napcat/${n}`,
    `.claude/skills/add-napcat/${n}`,
  ]),
  ["config.example.env", ".claude/skills/add-napcat/config.example.env"],
  ["README.md", ".claude/skills/add-napcat/README.md"],
  ["README.zh-CN.md", ".claude/skills/add-napcat/README.zh-CN.md"],
  ["LICENSE", ".claude/skills/add-napcat/LICENSE"],
];
const owned = new Set(entries.map((e) => e[1]));
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function optional(file) {
  try {
    return await fs.readFile(file);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function safe(target, rel) {
  if (path.isAbsolute(rel) || rel.split("/").includes(".."))
    throw new Error(`Unsafe path: ${rel}`);
  let current = target;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error(`Conflict: symlink ${rel}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return path.join(target, rel);
}
function parsed(text, name) {
  return ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
async function compatibility(target) {
  const current = await fs.readFile(
    await safe(target, "src/channels/adapter.ts"),
    "utf8",
  );
  const baseline = await fs.readFile(
    path.join(source, "tests/host/channels/adapter.ts"),
    "utf8",
  );
  const declarations = (text) =>
    new Map(
      parsed(text, "adapter.ts")
        .statements.filter(ts.isInterfaceDeclaration)
        .map((n) => [n.name.text, n]),
    );
  const actual = declarations(current),
    expected = declarations(baseline);
  // Compare syntax structure rather than printer output: quote style and
  // trailing commas carry no contract meaning.
  const tree = (node) => {
    const children = [];
    ts.forEachChild(node, (child) => {
      children.push(tree(child));
    });
    return [
      node.kind,
      ts.isIdentifier(node) ||
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node)
        ? node.text
        : null,
      children,
    ];
  };
  const signature = (node) => JSON.stringify(tree(node));
  for (const name of [
    "ChannelAdapter",
    "ChannelSetup",
    "InboundMessage",
    "OutboundMessage",
    "OutboundFile",
    "ChannelDefaults",
    "ChannelContextDefaults",
  ]) {
    const a = actual.get(name),
      b = expected.get(name);
    if (!a) throw new Error(`Incompatible host: missing ${name}`);
    const members = new Map(a.members.map((n) => [n.name?.getText(), n]));
    for (const member of b.members) {
      const other = members.get(member.name?.getText());
      if (!other || signature(member) !== signature(other))
        throw new Error(
          `Incompatible host: ${name}.${member.name?.getText()} signature changed`,
        );
    }
    const names = new Set(b.members.map((n) => n.name?.getText()));
    for (const member of a.members)
      if (!names.has(member.name?.getText()) && !member.questionToken)
        throw new Error(
          `Incompatible host: required ${name}.${member.name?.getText()}`,
        );
  }
  for (const [file, symbol] of [
    ["src/channels/channel-registry.ts", "registerChannelAdapter"],
    ["src/channels/question-render-registry.ts", "resolveQuestionRender"],
    ["src/env.ts", "readEnvFile"],
  ]) {
    const text = await fs.readFile(await safe(target, file), "utf8");
    if (
      !parsed(text, file).statements.some(
        (n) =>
          ts.isFunctionDeclaration(n) &&
          n.name?.text === symbol &&
          n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      )
    )
      throw new Error(`Incompatible host: missing export ${symbol}`);
  }
}
async function usedElsewhere(target, excluded) {
  const packageRef = (value) =>
    value === "ws" ||
    value.startsWith("ws/") ||
    value === "@types/ws" ||
    value.startsWith("@types/ws/");
  const ignored = new Set([
    "node_modules",
    ".git",
    "dist",
    "data",
    "logs",
    ".superpowers",
  ]);
  function consumes(text, file) {
    const tree = parsed(text, file);
    if (tree.typeReferenceDirectives.some((r) => packageRef(r.fileName)))
      return true;
    let found = false;
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) ||
          ts.isExportDeclaration(node) ||
          ts.isModuleDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        packageRef(node.moduleSpecifier.text)
      )
        found = true;
      if (
        ts.isModuleDeclaration(node) &&
        ts.isStringLiteral(node.name) &&
        packageRef(node.name.text)
      )
        found = true;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        packageRef(node.arguments[0].text)
      )
        found = true;
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal) &&
        packageRef(node.argument.literal.text)
      )
        found = true;
      if (!found) ts.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const file = path.join(dir, entry.name),
        rel = path.relative(target, file).split(path.sep).join("/");
      if (excluded.has(rel)) continue;
      if (entry.isSymbolicLink()) {
        if (/\.[cm]?[jt]sx?$/.test(file)) return true;
        continue;
      }
      if (entry.isDirectory()) {
        if (await walk(file)) return true;
      } else if (
        /\.[cm]?[jt]sx?$/.test(file) &&
        consumes(await fs.readFile(file, "utf8"), file)
      )
        return true;
      else if (entry.name === "package.json") {
        const pkg = JSON.parse(await fs.readFile(file, "utf8"));
        if (pkg.peerDependencies?.ws || pkg.optionalDependencies?.ws)
          return true;
        // Package scripts can consume ws without a standalone source file.
        if (
          Object.values(pkg.scripts ?? {}).some((value) =>
            /\b(?:ws|@types\/ws)\b/.test(value),
          )
        )
          return true;
      }
    }
    return false;
  }
  return walk(target);
}
async function updatedLock(target, pkg) {
  const pnpm =
    !!(await optional(path.join(target, "pnpm-lock.yaml"))) ||
    pkg.packageManager?.startsWith("pnpm@");
  const lock = pnpm ? "pnpm-lock.yaml" : "package-lock.json";
  const staging = await fs.mkdtemp(path.join(tmpdir(), "napcat-lock-"));
  try {
    await fs.writeFile(
      path.join(staging, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
    for (const f of [lock, "pnpm-workspace.yaml", ".npmrc"]) {
      const data = await optional(await safe(target, f));
      if (data) await fs.writeFile(path.join(staging, f), data);
    }
    const command = pnpm ? "pnpm" : "npm";
    const args = pnpm
      ? ["install", "--lockfile-only", "--ignore-scripts"]
      : [
          "install",
          "--package-lock-only",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ];
    const result = spawnSync(command, args, {
      cwd: staging,
      encoding: "utf8",
      timeout: 180_000,
    });
    if (result.status !== 0)
      throw new Error(
        `Dependency lock generation failed (${command}); target unchanged. ${result.error?.message ?? ""}\n${result.stderr || result.stdout}`,
      );
    return [lock, await fs.readFile(path.join(staging, lock))];
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
async function apply(target, changes) {
  const before = new Map();
  for (const rel of changes.keys())
    before.set(rel, await optional(await safe(target, rel)));
  const write = async (rel, data) => {
    const file = await safe(target, rel);
    if (data === null) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + `.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, data);
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
  };
  try {
    for (const [rel, data] of changes) await write(rel, data);
  } catch (error) {
    for (const [rel, data] of [...before].reverse()) await write(rel, data);
    throw error;
  }
  // Remove only empty owned directories, preserving additional user files.
  const dirs = new Set(
    [...changes.keys()]
      .filter((k) => owned.has(k) || k === statePath)
      .map((k) => path.dirname(k)),
  );
  for (const dir of [...dirs].sort((a, b) => b.length - a.length))
    await fs.rmdir(path.join(target, dir)).catch((e) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(e.code)) throw e;
    });
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["install", "uninstall"].includes(command))
    throw new Error(
      "Usage: node scripts/channel.mjs install|uninstall --target <NanoClaw path> [--dry-run]",
    );
  let targetArg,
    dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1] && !args[i + 1].startsWith("--"))
      targetArg = args[++i];
    else if (args[i] === "--dry-run") dry = true;
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  if (!targetArg) throw new Error("Explicit --target is required");
  const target = await fs.realpath(path.resolve(targetArg));
  if (target === source)
    throw new Error("Target must be a NanoClaw host, not this source package");
  let lockHandle;
  if (!dry)
    lockHandle = await fs
      .open(await safe(target, ".napcat-install.lock"), "wx")
      .catch(() => {
        throw new Error(
          "Install lock exists; confirm no installer is running before removing .napcat-install.lock",
        );
      });
  try {
    const stateFile = await safe(target, statePath),
      stateBytes = await optional(stateFile),
      state = stateBytes ? JSON.parse(stateBytes) : null;
    if (
      state &&
      (state.version !== 1 ||
        !state.files ||
        Object.keys(state.files).some((k) => !owned.has(k)))
    )
      throw new Error("Conflict: invalid installation manifest");
    if (command === "install") await compatibility(target);
    if (command === "uninstall" && !state) {
      console.log("NapCat is not installed; no changes");
      return;
    }
    for (const rel of owned) {
      const data = await optional(await safe(target, rel)),
        expected = state?.files[rel];
      if (expected ? !data || hash(data) !== expected : data !== null)
        throw new Error(`Conflict: ${rel} is unowned or modified`);
    }
    const barrelPath = "src/channels/index.ts",
      barrel = (await fs.readFile(await safe(target, barrelPath))).toString();
    const imports = parsed(barrel, barrelPath).statements.filter(
      (n) =>
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text === "./napcat.js",
    );
    if (
      state
        ? imports.length !== 1 || !barrel.includes(state.barrelAddition)
        : imports.length !== 0
    )
      throw new Error(
        "Conflict: NapCat barrel registration is unowned or modified",
      );
    const pkgPath = await safe(target, "package.json"),
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    const changes = new Map(),
      added = state?.addedDependencies ?? [];
    const promoted = state?.promotedDependencies ?? [];
    if (command === "install") {
      for (const [section, name, version] of pins) {
        const own = pkg[section]?.[name];
        const otherSection =
          section === "dependencies" ? "devDependencies" : "dependencies";
        const other = pkg[otherSection]?.[name];
        for (const existing of [own, other])
          if (existing && existing !== version)
            throw new Error(
              `Conflict: ${name} already uses ${existing}; required exact pin ${version}`,
            );
        if (!own && (section === "dependencies" || !other)) {
          pkg[section] ??= {};
          pkg[section][name] = version;
          if (!added.some((p) => p[0] === section && p[1] === name))
            added.push([section, name, version]);
          if (section === "dependencies" && other) {
            delete pkg[otherSection][name];
            if (!promoted.some((p) => p[0] === name))
              promoted.push([name, version]);
          }
        }
      }
      const hashes = {};
      for (const [from, to] of entries) {
        let data = await fs.readFile(path.join(source, from));
        if (from === "README.md" || from === "README.zh-CN.md")
          data = Buffer.from(
            data
              .toString()
              .replaceAll("](skills/add-napcat/REMOVE.md)", "](REMOVE.md)")
              .replace(
                "[docs/PROGRESS.md](docs/PROGRESS.md)",
                "源码包中的 docs/PROGRESS.md",
              ),
          );
        changes.set(to, data);
        hashes[to] = hash(data);
      }
      const addition =
        state?.barrelAddition ??
        (barrel.endsWith("\n") || !barrel ? "" : "\n") + importLine;
      changes.set(barrelPath, Buffer.from(state ? barrel : barrel + addition));
      changes.set(
        statePath,
        Buffer.from(
          JSON.stringify(
            {
              version: 1,
              files: hashes,
              barrelAddition: addition,
              addedDependencies: added,
              promotedDependencies: promoted,
            },
            null,
            2,
          ) + "\n",
        ),
      );
    } else {
      for (const rel of owned) changes.set(rel, null);
      changes.set(statePath, null);
      changes.set(
        barrelPath,
        Buffer.from(barrel.replace(state.barrelAddition, "")),
      );
      const shared = await usedElsewhere(target, owned);
      for (const [section, name, version] of added) {
        if (
          !pins.some(
            (p) => p[0] === section && p[1] === name && p[2] === version,
          )
        )
          throw new Error("Conflict: invalid dependency ownership");
        if (pkg[section]?.[name] === version && !shared) {
          delete pkg[section][name];
          if (promoted.some((p) => p[0] === name && p[1] === version)) {
            pkg.devDependencies ??= {};
            if (pkg.devDependencies[name] === undefined)
              pkg.devDependencies[name] = version;
          }
        } else console.log(`Retain shared/user dependency ${name}`);
      }
    }
    const currentPkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    const depChanged = JSON.stringify(pkg) !== JSON.stringify(currentPkg);
    if (depChanged)
      changes.set(
        "package.json",
        Buffer.from(JSON.stringify(pkg, null, 2) + "\n"),
      );
    for (const [rel, data] of [...changes]) {
      const existing = await optional(await safe(target, rel));
      if (data === null ? existing === null : existing?.equals(data))
        changes.delete(rel);
    }
    if (dry) {
      console.log(`Dry run: ${command} ${target}`);
      for (const [rel, data] of changes)
        console.log(`${data === null ? "delete" : "write"} ${rel}`);
      if (depChanged)
        console.log(
          "update dependency lockfile (staged before target changes)",
        );
      return;
    }
    if (depChanged) {
      const [lock, data] = await updatedLock(target, pkg);
      changes.set(lock, data);
    }
    await apply(target, changes);
    console.log(
      `${command} complete (${changes.size} files changed). Run the host package manager with its frozen lockfile, then build.`,
    );
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      await fs.rm(path.join(target, ".napcat-install.lock"), { force: true });
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
