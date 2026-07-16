import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Side = 0 | 1;
type AnyRecord = Record<string, unknown>;
type EvidenceKind = "played" | "discarded" | "tuned" | "transferred" | "visible";

type SourceCard = {
  id: number;
  name?: string;
  file: string;
  line: number;
  sourceSignals: string[];
};

type RuntimeCard = {
  present: boolean;
  type?: string;
  obtainable?: boolean;
  tags?: string[];
};

type CardExpectation = "directly-obtainable" | "character-deck-obtainable" | "generated-only" | "historical-or-runtime-missing" | "runtime-unavailable";

type CardEvidence = {
  id: number;
  name: string;
  source?: { file: string; line: number; sourceSignals: string[] };
  runtime: RuntimeCard;
  expectation: CardExpectation;
  inConfiguredDeck: boolean;
  visibleInTrace: boolean;
  zones: string[];
  events: Record<EvidenceKind, number>;
  evidenceLevel: "trace-observed" | "catalog-only";
};

const root = resolve(".");
const upstreamRoot = resolve(process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation");
const catalogPath = resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json");
const outputPath = resolve(process.env.TRACKER_CARD_COVERAGE_OUTPUT ?? "records/coverage/card-coverage.json");
const tracesFromEnv = process.env.TRACKER_CARD_COVERAGE_TRACES?.split(",").map((value) => value.trim()).filter(Boolean);

async function filesUnder(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(child));
    else if (entry.isFile() && /\.(?:ts|gts)$/.test(entry.name)) result.push(child);
  }
  return result;
}

function record(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function definitionId(value: unknown): number | undefined {
  return integer(record(value)?.definitionId);
}

function side(value: unknown): Side | undefined {
  return value === 0 || value === 1 ? value : undefined;
}

function mutationCase(value: unknown): { name: string; value: AnyRecord } | undefined {
  const outer = record(value);
  const candidate = record(outer?.mutation) ?? outer;
  if (!candidate || typeof candidate.$case !== "string") return undefined;
  return { name: candidate.$case, value: record(candidate.value) ?? candidate };
}

function isHand(value: unknown): boolean {
  return value === "hands" || value === "hand" || value === 5;
}

function isPile(value: unknown): boolean {
  return value === "pile" || value === 6;
}

function isBoard(value: unknown): boolean {
  return value === "character" || value === "characters" || value === 1
    || value === "combatStatus" || value === "combatStatuses" || value === 2
    || value === "summon" || value === "summons" || value === 3
    || value === "support" || value === "supports" || value === 4;
}

function isCardArea(value: unknown): boolean {
  return isHand(value) || isPile(value);
}

function isPublicPlayReason(value: unknown): boolean {
  const code = Number(value);
  const name = String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return name === "EVENTCARDPLAYED" || name === "EVENTCARDPLAYNOEFFECT"
    || name === "EQUIPOVERRIDDEN" || name === "CREATESUPPORTOVERRIDDEN"
    || code === 1 || code === 5 || code === 7 || code === 8;
}

function addVisible(
  evidence: Map<number, { zones: Set<string>; events: Record<EvidenceKind, number> }>,
  id: number | undefined,
  zone: string,
  event?: EvidenceKind,
): void {
  if (id === undefined || id === 0) return;
  const current = evidence.get(id) ?? {
    zones: new Set<string>(),
    events: { played: 0, discarded: 0, tuned: 0, transferred: 0, visible: 0 },
  };
  current.zones.add(zone);
  current.events.visible += event === "visible" || event === undefined ? 1 : 0;
  if (event && event !== "visible") current.events[event] += 1;
  evidence.set(id, current);
}

function sourceSignals(body: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ["hand_exchange", /\b(?:switchCards|swapPlayerHandCards)\b/],
    ["draw", /\b(?:drawCards|drawCard|onDrawTriggered|on\(["']drawCard)/],
    ["generate_hand", /\b(?:createHandCard|selectAndCreateHandCard)\b/],
    ["generate_pile", /\b(?:createPileCards|createEntity\(\s*["']pile)/],
    ["return_to_deck", /\b(?:undrawCards|toWhere[^\n]*pile|fromWhere[^\n]*pile)\b/],
    ["steal_transfer", /\bstealHandCard\b/],
    ["transform", /\btransformDefinition\b/],
    ["discard_or_tune", /\b(?:disposeCard|disposeMaxCostHands|disposeFromHands|elementalTuning|selfDiscard|disposeOrTuneCard)\b/],
    ["public_entity", /\b(?:characterStatus|combatStatus|summon|support|createEntity|createAttachment|attach|equip)\b/],
    ["selection", /\b(?:selectCard|selectAndCreateHandCard|selectAndSummon)\b/],
    ["dice", /\b(?:convertDice|generateDice|absorbDice)\b/],
    ["skill", /\buseSkill\b/],
    ["random", /\b(?:random|randomly)\b/],
    ["conditional", /\b(?:filter|if\s*\(|switch\s*\()/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(body)).map(([name]) => name);
}

async function indexSourceCards(): Promise<Map<number, SourceCard>> {
  const sourceRoot = resolve(upstreamRoot, "packages/data/src");
  const result = new Map<number, SourceCard>();
  for (const file of (await filesUnder(sourceRoot)).filter((path) => !path.includes("/old_versions/"))) {
    const source = await readFile(file, "utf8");
    const blockPattern = /\/\*\*([\s\S]*?)\*\/([\s\S]*?)(?=\/\*\*|$)/g;
    for (const match of source.matchAll(blockPattern)) {
      const doc = match[1] ?? "";
      const body = match[2] ?? "";
      const idMatch = /@id\s+(\d+)/.exec(doc);
      if (!idMatch) continue;
      const id = Number(idMatch[1]);
      const declaration = /\b(?:card|character|skill|status|combatStatus|summon|support|equipment)\s*\(\s*\d+\s*\)/.test(body)
        || /\bdefine\s+card\b/.test(body);
      if (!declaration || !/\b(?:card|define\s+card)\b/.test(body)) continue;
      const offset = match.index ?? 0;
      const line = source.slice(0, offset).split("\n").length;
      const current = result.get(id);
      const candidate: SourceCard = {
        id,
        name: /@name\s+([^\r\n]+)/.exec(doc)?.[1]?.trim(),
        file: relative(root, file),
        line,
        sourceSignals: sourceSignals(body),
      };
      if (!current || candidate.file.localeCompare(current.file) > 0) result.set(id, candidate);
    }
  }
  return result;
}

async function loadRuntimeCards(): Promise<{
  available: boolean;
  error?: string;
  cards: Map<number, RuntimeCard>;
}> {
  try {
    const core = await import(pathToFileURL(resolve(upstreamRoot, "packages/core/dist/index.js")).href) as AnyRecord;
    const dataModule = await import(pathToFileURL(resolve(upstreamRoot, "packages/data/dist/index.js")).href) as AnyRecord;
    const factory = dataModule.default;
    if (typeof factory !== "function") throw new Error("upstream data module has no default factory");
    const data = record(factory(core.CURRENT_VERSION));
    const entities = data?.entities;
    if (!(entities instanceof Map)) throw new Error("upstream data factory has no entity Map");
    const cards = new Map<number, RuntimeCard>();
    for (const [rawId, rawEntity] of entities.entries()) {
      const entity = record(rawEntity);
      const type = typeof entity?.type === "string" ? entity.type : undefined;
      if (!entity || !type || !["eventCard", "support", "equipment"].includes(type)) continue;
      const id = integer(rawId) ?? integer(entity.id);
      if (id === undefined) continue;
      const tags = Array.isArray(entity.tags)
        ? entity.tags.map((tag) => String(tag)).sort()
        : undefined;
      cards.set(id, {
        present: true,
        type,
        obtainable: entity.obtainable !== false,
        ...(tags?.length ? { tags } : {}),
      });
    }
    return { available: true, cards };
  } catch (error) {
    return {
      available: false,
      error: String(error instanceof Error ? error.message : error),
      cards: new Map(),
    };
  }
}

function tracePaths(): string[] {
  if (tracesFromEnv?.length) return tracesFromEnv.map((path) => resolve(path));
  return ["20260715", "20260716", "20260717", "20260718", "20260719", "20260720"]
    .flatMap((seed) => [0, 1].map((perspective) => resolve(`records/simulator/game-${seed}-p${perspective}.jsonl`)));
}

async function configuredDeckIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const file of ["harness/decks/standard-a.json", "harness/decks/standard-b.json"]) {
    try {
      const deck = JSON.parse(await readFile(resolve(file), "utf8")) as AnyRecord;
      for (const id of Array.isArray(deck.cards) ? deck.cards : []) if (integer(id) !== undefined) ids.add(id as number);
    } catch {
      // A missing fixture deck should not hide the catalog coverage gap.
    }
  }
  return ids;
}

async function scanTraces(
  evidence: Map<number, { zones: Set<string>; events: Record<EvidenceKind, number> }>,
): Promise<{ files: number; notifications: number; missingFiles: string[] }> {
  let files = 0;
  let notifications = 0;
  const missingFiles: string[] = [];
  for (const path of tracePaths()) {
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      missingFiles.push(relative(root, path));
      continue;
    }
    files += 1;
    let perspective: Side = path.endsWith("-p1.jsonl") ? 1 : 0;
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as AnyRecord;
      if (row.kind === "session") {
        const sessionPerspective = side(row.perspective);
        if (sessionPerspective !== undefined) perspective = sessionPerspective;
        continue;
      }
      if (row.kind !== "notification" && row.kind !== "frame") continue;
      notifications += 1;
      const state = record(row.state);
      const players = Array.isArray(state?.player) ? state.player : [];
      for (const [whoIndex, rawPlayer] of players.entries()) {
        const who = whoIndex as Side;
        const player = record(rawPlayer);
        if (!player) continue;
        const publicZones = who === perspective ? ["handCard", "pileCard", "character", "combatStatus", "summon", "support"]
          : ["character", "combatStatus", "summon", "support"];
        for (const zone of publicZones) {
          for (const rawEntity of Array.isArray(player[zone]) ? player[zone] : []) {
            addVisible(evidence, definitionId(rawEntity), `${who}:${zone}`);
          }
        }
      }
      const mutations = Array.isArray(row.mutation) ? row.mutation : [];
      for (const rawMutation of mutations) {
        const parsed = mutationCase(rawMutation);
        if (!parsed) continue;
        const value = parsed.value;
        if (parsed.name === "removeEntity") {
          const who = side(value.who);
          const id = definitionId(value.entity);
          const visible = who === perspective || (isHand(value.where) && isPublicPlayReason(value.reason));
          if (!visible || id === undefined) continue;
          const event: EvidenceKind = isHand(value.where) && isPublicPlayReason(value.reason)
            ? "played"
            : Number(value.reason) === 2 || String(value.reason ?? "").toUpperCase().includes("TUNING")
              ? "tuned"
              : "discarded";
          addVisible(evidence, id, `${who ?? "?"}:${isHand(value.where) ? "hand" : "pile"}:mutation`, event);
        } else if (parsed.name === "moveEntity") {
          const fromWho = side(value.fromWho);
          const toWho = side(value.toWho);
          const id = definitionId(value.entity);
          const publicMove = isBoard(value.toWhere) || fromWho === perspective || toWho === perspective;
          if (!publicMove || id === undefined) continue;
          const event: EvidenceKind = isHand(value.fromWhere) && isBoard(value.toWhere)
            ? "played"
            : fromWho !== undefined && toWho !== undefined && fromWho !== toWho ? "transferred" : "visible";
          addVisible(evidence, id, `${toWho ?? fromWho ?? "?"}:move`, event);
        } else if (parsed.name === "createEntity") {
          const who = side(value.who);
          const id = definitionId(value.entity);
          if (id === undefined || (isCardArea(value.where) && who !== perspective)) continue;
          addVisible(evidence, id, `${who ?? "?"}:create`, "visible");
        }
      }
      if (lineIndex < 0) throw new Error("unreachable");
    }
  }
  return { files, notifications, missingFiles };
}

const catalogRaw = JSON.parse(await readFile(catalogPath, "utf8")) as AnyRecord;
const catalogEntries = record(catalogRaw.cards) ?? {};
const catalogCards = Object.values(catalogEntries)
  .filter((value): value is AnyRecord => Boolean(record(value)) && record(value)?.kind === "card")
  .map((value) => ({ id: integer(value.id), name: String(value.name ?? `#${value.id}`) }))
  .filter((value): value is { id: number; name: string } => value.id !== undefined)
  .sort((a, b) => a.id - b.id);
const sourceCards = await indexSourceCards();
const runtime = await loadRuntimeCards();
const deckIds = await configuredDeckIds();
const evidence = new Map<number, { zones: Set<string>; events: Record<EvidenceKind, number> }>();
const traceSummary = await scanTraces(evidence);
const cards: CardEvidence[] = catalogCards.map(({ id, name }) => {
  const source = sourceCards.get(id);
  const runtimeCard = runtime.cards.get(id) ?? { present: false };
  const observed = evidence.get(id);
  const characterDeckObtainable = (runtimeCard.tags ?? []).some((tag) => tag === "talent" || tag === "technique");
  const expectation: CardExpectation = !runtime.available
    ? "runtime-unavailable"
    : !runtimeCard.present
      ? "historical-or-runtime-missing"
      : characterDeckObtainable
        ? "character-deck-obtainable"
        : runtimeCard.obtainable === false
          ? "generated-only"
          : "directly-obtainable";
  return {
    id,
    name,
    ...(source ? { source: { file: source.file, line: source.line, sourceSignals: source.sourceSignals } } : {}),
    runtime: runtimeCard,
    expectation,
    inConfiguredDeck: deckIds.has(id),
    visibleInTrace: observed !== undefined,
    zones: [...(observed?.zones ?? [])].sort(),
    events: observed?.events ?? { played: 0, discarded: 0, tuned: 0, transferred: 0, visible: 0 },
    evidenceLevel: observed ? "trace-observed" : "catalog-only",
  };
});
const sourceMechanics = new Map<string, number>();
for (const card of cards) for (const signal of card.source?.sourceSignals ?? []) sourceMechanics.set(signal, (sourceMechanics.get(signal) ?? 0) + 1);
const unobserved = cards.filter((card) => !card.visibleInTrace);
const report = {
  generatedAt: new Date().toISOString(),
  upstreamRoot,
  catalogPath: relative(root, catalogPath),
  traceSummary,
  runtimeMetadata: {
    available: runtime.available,
    ...(runtime.error ? { error: runtime.error } : {}),
  },
  summary: {
    catalogCards: cards.length,
    sourceIndexedCards: cards.filter((card) => card.source).length,
    configuredDeckCards: cards.filter((card) => card.inConfiguredDeck).length,
    traceObservedCards: cards.filter((card) => card.visibleInTrace).length,
    traceUnobservedCards: unobserved.length,
    cardsWithLedgerEvent: cards.filter((card) => Object.entries(card.events).some(([key, count]) => key !== "visible" && count > 0)).length,
    runtimeActionCards: runtime.cards.size,
    runtimeObtainableActionCards: [...runtime.cards.values()].filter((card) => card.obtainable !== false).length,
    runtimeCharacterDeckActionCards: [...runtime.cards.values()].filter((card) => card.obtainable === false
      && (card.tags ?? []).some((tag) => tag === "talent" || tag === "technique")).length,
    runtimeGeneratedOnlyActionCards: [...runtime.cards.values()].filter((card) => card.obtainable === false
      && !(card.tags ?? []).some((tag) => tag === "talent" || tag === "technique")).length,
    catalogRuntimeActionCards: cards.filter((card) => card.runtime.present).length,
    catalogOnlyOutsideRuntime: cards.filter((card) => card.expectation === "historical-or-runtime-missing").length,
    sourceMechanicSignals: Object.fromEntries([...sourceMechanics.entries()].sort(([a], [b]) => a.localeCompare(b))),
  },
  cards,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  output: relative(root, outputPath),
  ...report.summary,
  runtimeMetadata: report.runtimeMetadata,
  unobservedSample: unobserved.slice(0, 20).map((card) => `${card.id} ${card.name}`),
  missingFiles: traceSummary.missingFiles,
}, null, 2));
