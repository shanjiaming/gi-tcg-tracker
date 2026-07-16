import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (path.endsWith(".ts") || path.endsWith(".js")) result.push(path);
  }
  return result;
}

const roots = ["src", "scripts", "test"].map((path) => resolve(path));
const paths = (await Promise.all(roots.map(files))).flat();
for (const path of paths) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `syntax check failed: ${path}\n`);
    process.exit(result.status ?? 1);
  }
}
console.log(`syntax-ok ${paths.length}`);
