import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
};

// Prove build starts clean rather than letting deleted APIs survive in dist/.
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/tool-contract.js", import.meta.url), "stale\n");
run("npm", ["run", "build"]);

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (packageJson.dependencies !== undefined) {
  throw new Error("SDK must not declare runtime dependencies");
}
if (JSON.stringify(Object.keys(packageJson.exports)) !== JSON.stringify(["."])) {
  throw new Error("SDK package must export only its root entrypoint");
}

const pack = JSON.parse(
  run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]),
);
const files = pack[0].files.map(({ path }) => path).sort();
const expected = [
  "README.md",
  "dist/agent-to-keeper.d.ts",
  "dist/agent-to-keeper.d.ts.map",
  "dist/agent-to-keeper.js",
  "dist/agent-to-keeper.js.map",
  "dist/claude-to-keeper.d.ts",
  "dist/claude-to-keeper.d.ts.map",
  "dist/claude-to-keeper.js",
  "dist/claude-to-keeper.js.map",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/index.js",
  "dist/index.js.map",
  "dist/keeper-events.d.ts",
  "dist/keeper-events.d.ts.map",
  "dist/keeper-events.js",
  "dist/keeper-events.js.map",
  "package.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(
    `Unexpected package contents:\n${files.map((file) => `- ${file}`).join("\n")}`,
  );
}

console.log(`Package surface verified (${files.length} files, zero runtime dependencies).`);
