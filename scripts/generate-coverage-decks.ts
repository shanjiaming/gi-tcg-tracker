import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type AnyRecord = Record<string, unknown>;
type CoverageCard = {
  id: number;
  name: string;
  expectation: string;
  source?: { sourceSignals?: string[] };
  runtime?: { present?: boolean; obtainable?: boolean };
};
type CoverageReport = { cards?: unknown };

const root = resolve(".");
const coveragePath = resolve(process.env.TRACKER_CARD_COVERAGE_INPUT ?? "records/coverage/card-coverage.json");
const outputRoot = resolve(process.env.TRACKER_COVERAGE_DECK_DIR ?? "records/coverage-decks");
const fillerDeckPath = resolve(process.env.TRACKER_COVERAGE_FILLER_DECK ?? "harness/decks/standard-a.json");
const chunkSize = Math.max(1, Math.min(15, Number(process.env.TRACKER_COVERAGE_UNIQUE_PER_DECK ?? 15)));
const requestedSignals = (process.env.TRACKER_COVERAGE_SIGNALS
  ?? "hand_exchange,generate_hand,generate_pile,return_to_deck,steal_transfer,transform,discard_or_tune,selection,dice,random,conditional,public_entity")
  .split(",").map((value) => value.trim()).filter(Boolean);

function record(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as CoverageReport;
const cards: CoverageCard[] = [];
for (const value of (Array.isArray(coverage.cards) ? coverage.cards : [])) {
  const raw = record(value);
  const id = integer(raw?.id);
  if (id === undefined) continue;
  const source = record(raw?.source);
  const runtime = record(raw?.runtime);
  const card: CoverageCard = {
    id,
    name: String(raw?.name ?? `#${id}`),
    expectation: String(raw?.expectation ?? ""),
    ...(source ? { source: { sourceSignals: Array.isArray(source.sourceSignals)
      ? source.sourceSignals.filter((signal): signal is string => typeof signal === "string")
      : [] } } : {}),
    ...(runtime ? { runtime: {
      present: runtime.present === true,
      obtainable: runtime.obtainable !== false,
    } } : {}),
  };
  if (card.expectation === "directly-obtainable" && card.runtime?.present === true) cards.push(card);
}

const filler = JSON.parse(await readFile(fillerDeckPath, "utf8")) as AnyRecord;
const fillerCards = (Array.isArray(filler.cards) ? filler.cards : [])
  .map(integer)
  .filter((id): id is number => id !== undefined);
const characters = (process.env.TRACKER_COVERAGE_CHARACTERS ?? "1701,1709,2405")
  .split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger);
if (characters.length !== 3) throw new Error("TRACKER_COVERAGE_CHARACTERS must contain exactly three integer ids");

const bySignal = new Map<string, CoverageCard[]>();
for (const card of cards) {
  for (const signal of card.source?.sourceSignals ?? []) {
    const group = bySignal.get(signal) ?? [];
    group.push(card);
    bySignal.set(signal, group);
  }
}
if (requestedSignals.includes("direct")) {
  bySignal.set("direct", cards.filter((card) => (card.source?.sourceSignals ?? []).length === 0));
}

await mkdir(outputRoot, { recursive: true });
const generated: Array<{ signal: string; index: number; path: string; targets: number[]; filler: number[] }> = [];
for (const signal of requestedSignals) {
  const candidates = bySignal.get(signal) ?? [];
  for (let offset = 0, index = 1; offset < candidates.length; offset += chunkSize, index += 1) {
    const targetCards = candidates.slice(offset, offset + chunkSize).map((card) => card.id);
    const unique = [...new Set(targetCards)];
    const fillerIds: number[] = [];
    for (const id of fillerCards) {
      if (unique.includes(id)) continue;
      unique.push(id);
      fillerIds.push(id);
      if (unique.length >= chunkSize) break;
    }
    if (unique.length < chunkSize) {
      throw new Error(`cannot build ${signal} deck: only ${unique.length} unique cards available`);
    }
    const deck = { characters, cards: unique.slice(0, chunkSize).flatMap((id) => [id, id]) };
    const path = resolve(outputRoot, `${signal}-${String(index).padStart(3, "0")}.json`);
    await writeFile(path, JSON.stringify(deck, null, 2) + "\n", "utf8");
    generated.push({ signal, index, path: path.replace(`${root}/`, ""), targets: targetCards, filler: fillerIds });
  }
}

console.log(JSON.stringify({
  coverage: coveragePath.replace(`${root}/`, ""),
  outputRoot: outputRoot.replace(`${root}/`, ""),
  eligibleCards: cards.length,
  requestedSignals,
  generatedDecks: generated.length,
  decks: generated,
}, null, 2));
