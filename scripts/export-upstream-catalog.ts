import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const upstream = resolve(process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation");
const sourceRoot = join(upstream, "packages/data/src");
const output = resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json");

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(?:ts|gts)$/.test(entry.name)) result.push(path);
  }
  return result;
}

const cards: Record<string, { id: number; name: string; kind: string }> = {};
const blockPattern = /\/\*\*([\s\S]*?)\*\/([\s\S]*?)(?=\/\*\*|$)/g;
for (const path of await files(sourceRoot)) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(blockPattern)) {
    const block = match[1] ?? "";
    const body = match[2] ?? "";
    const name = /@name\s+([^\r\n]+)/.exec(block)?.[1]?.trim();
    const declaration = /\b(?:card|character|skill|status|combatStatus|summon|support|equipment)\s*\(\s*(\d+)\s*\)/.exec(body);
    const gtsDeclaration = /\bdefine\s+(card|character|skill|status|combatStatus|summon|support|equipment)\s*\{[\s\S]*?\bid\s+(\d+)\s+as\b/.exec(body);
    const rawKind = declaration
      ? /\b(card|character|skill|status|combatStatus|summon|support|equipment)\s*\(/.exec(declaration[0])?.[1]
      : gtsDeclaration?.[1];
    const id = Number(declaration?.[1] ?? gtsDeclaration?.[2]);
    if (!name || !Number.isSafeInteger(id)) continue;
    const kind = rawKind === "card" ? "card"
      : rawKind === "character" ? "character"
      : rawKind === "skill" ? "skill"
      : "entity";
    cards[String(id)] = { id, name, kind };
  }
}
await mkdir(join(output, ".."), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ upstream: "genius-invokation/packages/data/src", generatedAt: new Date().toISOString(), cards }, null, 2) + "\n",
  "utf8",
);
console.log(JSON.stringify({ output, entries: Object.keys(cards).length, upstream }));
