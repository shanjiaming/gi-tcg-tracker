import { resolve } from "node:path";
import { loadCatalog } from "../src/catalog.ts";
import { loadDeck } from "../src/decks.ts";
import { loadTrace } from "../src/trace.ts";

const path = resolve(process.argv[2] ?? process.env.TRACKER_TRACE ?? "records/simulator/game-20260715-p0.jsonl");
const catalog = await loadCatalog(resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json"));
const deckA = await loadDeck(resolve(process.argv[3] ?? process.env.TRACKER_DECK0 ?? "harness/decks/standard-a.json"));
const deckB = await loadDeck(resolve(process.argv[4] ?? process.env.TRACKER_DECK1 ?? "harness/decks/standard-b.json"));
const snapshot = await loadTrace(path, { catalog, decks: [deckA, deckB] });
console.log(JSON.stringify(snapshot, null, 2));
