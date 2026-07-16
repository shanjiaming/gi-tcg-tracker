import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(".");
const runtimeRoots = ["src", "scripts", "test"];
const forbidden = [
  { label: "old robot project", pattern: /gi-tcg-robot/i },
  { label: "LumiTracker runtime", pattern: /LumiTracker|LumiOwO/i },
  { label: "RL bridge dependency", pattern: /pybinding|RL\s+Agent/i },
  { label: "action-control bridge", pattern: /actionResponse|submitAction|dispatchAction|\/api\/action/i },
];

async function filesUnder(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(child));
    else if (entry.isFile() && /\.(?:ts|js|json)$/.test(entry.name)) files.push(child);
  }
  return files;
}

const files = (await Promise.all(runtimeRoots.map((directory) => filesUnder(resolve(directory))))).flat()
  .concat([resolve("package.json"), resolve("tsconfig.json")])
  .filter((file) => !file.endsWith("scripts/check-boundaries.ts"))
  .sort();
const violations: Array<{ file: string; label: string; match: string }> = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const rules = file.includes("/test/") ? forbidden.slice(0, 2) : forbidden;
  for (const rule of rules) {
    const match = source.match(rule.pattern);
    if (match) violations.push({ file: relative(root, file), label: rule.label, match: match[0] });
  }
}

if (violations.length > 0) {
  console.error(JSON.stringify({ ok: false, violations }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, scannedFiles: files.length, rules: forbidden.length }));
}
