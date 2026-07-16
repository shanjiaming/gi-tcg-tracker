import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type AnyRecord = Record<string, unknown>;

const root = resolve(".");
const coveragePath = resolve(process.env.TRACKER_CARD_COVERAGE_INPUT ?? "records/coverage/card-coverage.json");
const outputRoot = resolve(process.env.TRACKER_GENERATED_DECK_DIR ?? "records/coverage-decks/generated-character");
const fillerPath = resolve(process.env.TRACKER_COVERAGE_FILLER_DECK ?? "harness/decks/standard-a.json");
const genericCharacters = (process.env.TRACKER_GENERATED_GENERIC_CHARACTERS ?? "1701,1709,2405")
  .split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger);

// These companions are only for simulator coverage.  The generated cards in a
// character source often depend on a reaction, so a fixed Dendro/Electro filler
// pair leaves large parts of the branch graph unreachable.  The IDs below are
// normal playable characters from the pinned data set, selected by the source
// element to make the first active character and its opponent exchange useful
// elemental auras under the deterministic skills-first policy.
const reactionPartnersByElement: Record<string, number[]> = {
  anemo: [1202, 1303],
  cryo: [1202, 1401],
  dendro: [1202, 1303],
  electro: [1202, 1303],
  geo: [1202, 1303],
  hydro: [1303, 1401],
  pyro: [1202, 1401],
};

function record(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function sourceCharacterIds(source: string): number[] {
  const ids = [
    ...source.matchAll(/\bcharacter\((\d+)\)/g),
    ...source.matchAll(/define\s+character\s*\{[\s\S]*?\bid\s+(\d+)/g),
  ].map((match) => Number(match[1])).filter(Number.isSafeInteger);
  return [...new Set(ids)];
}

function sourceElement(sourceFile: string): string | undefined {
  const match = sourceFile.match(/\/characters\/([^/]+)\//);
  return match?.[1];
}

const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as AnyRecord;
const bySource = new Map<string, number[]>();
for (const raw of Array.isArray(coverage.cards) ? coverage.cards : []) {
  const card = record(raw);
  const source = record(card?.source);
  const id = integer(card?.id);
  if (id === undefined || card?.expectation !== "generated-only" || typeof source?.file !== "string"
    || !source.file.includes("/characters/")) continue;
  const ids = bySource.get(source.file) ?? [];
  ids.push(id);
  bySource.set(source.file, ids);
}

const filler = JSON.parse(await readFile(fillerPath, "utf8")) as AnyRecord;
const fillerCards = (Array.isArray(filler.cards) ? filler.cards : [])
  .map(integer).filter((id): id is number => id !== undefined);
await mkdir(outputRoot, { recursive: true });

const decks: AnyRecord[] = [];
for (const [index, [sourceFile, targetIds]] of [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)).entries()) {
  const sourceText = await readFile(resolve(root, sourceFile), "utf8");
  const element = sourceElement(sourceFile);
  const companions = reactionPartnersByElement[element ?? ""] ?? genericCharacters;
  const characters = [...new Set([...sourceCharacterIds(sourceText), ...companions, ...genericCharacters])].slice(0, 3);
  if (characters.length !== 3) continue;
  const unique = [...new Set(fillerCards)].filter((id) => !targetIds.includes(id)).slice(0, 15);
  if (unique.length < 15) throw new Error(`not enough filler cards for ${sourceFile}`);
  const deck = {
    characters,
    cards: unique.flatMap((id) => [id, id]),
    targets: [...new Set(targetIds)].sort((a, b) => a - b),
    sourceFile,
  };
  const path = resolve(outputRoot, `generated_character-${String(index + 1).padStart(3, "0")}.json`);
  await writeFile(path, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  decks.push({
    index: index + 1,
    path: path.replace(`${root}/`, ""),
    sourceFile,
    characters,
    targets: deck.targets,
  });
}

console.log(JSON.stringify({
  coverage: coveragePath.replace(`${root}/`, ""),
  outputRoot: outputRoot.replace(`${root}/`, ""),
  generatedDecks: decks.length,
  decks,
}, null, 2));
