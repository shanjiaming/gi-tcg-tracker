import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCatalog } from "../src/catalog.ts";
import { loadDeck } from "../src/decks.ts";
import { TrackerEngine } from "../src/engine.ts";
import { definitionId, frameFromNotification, mutationCase, side } from "../src/normalize.ts";
import type { Side } from "../src/types.ts";

const tracePath = resolve(process.argv[2] ?? process.env.TRACKER_TRACE ?? "records/simulator/game-20260715-p0.jsonl");
const catalog = await loadCatalog(resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json"));
const deckA = await loadDeck(resolve(process.env.TRACKER_DECK0 ?? "harness/decks/standard-a.json"));
const deckB = await loadDeck(resolve(process.env.TRACKER_DECK1 ?? "harness/decks/standard-b.json"));
const engine = new TrackerEngine({ catalog, decks: [deckA, deckB] });
const lines = (await readFile(tracePath, "utf8")).split(/\r?\n/).filter(Boolean);
let perspective: Side = 0;
let previousSequence = 0;
let notifications = 0;
let terminal = 0;
let lastPhase: unknown;
let errors = 0;
let maskedStateLeaks = 0;
let maskedSnapshotLeaks = 0;
const mutationCounts = new Map<string, number>();
const expected = new Map<string, { played: number; discarded: number; tuned: number; transferred: number }>();
const verifiedCardEvents = { played: 0, discarded: 0, tuned: 0, transferred: 0 };

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function isHandArea(value: unknown): boolean {
  return value === "hands" || value === "hand" || value === 5;
}

function isPileArea(value: unknown): boolean {
  return value === "pile" || value === 6;
}

function isCardArea(value: unknown): boolean {
  return isHandArea(value) || isPileArea(value);
}

function isBoardArea(value: unknown): boolean {
  return value === "character" || value === "characters" || value === 1
    || value === "combatStatus" || value === "combatStatuses" || value === 2
    || value === "summon" || value === "summons" || value === 3
    || value === "support" || value === "supports" || value === 4;
}

function isPlayedReason(value: unknown): boolean {
  const reason = Number(value);
  const reasonName = String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return reasonName === "EVENTCARDPLAYED" || reasonName === "EVENTCARDPLAYNOEFFECT"
    || reasonName === "EQUIPOVERRIDDEN" || reasonName === "CREATESUPPORTOVERRIDDEN"
    || reason === 1 || reason === 5 || reason === 7 || reason === 8;
}

function mutationDefinitionIsVisible(perspectiveValue: Side, name: string, value: Record<string, unknown>): boolean {
  const targetSide = side(value.toWho ?? value.who ?? value.fromWho);
  if (name === "createEntity") return !isCardArea(value.where) || targetSide === perspectiveValue;
  if (name === "removeEntity") return targetSide === perspectiveValue
    || (isHandArea(value.where) && isPlayedReason(value.reason));
  if (name === "moveEntity") {
    if (isBoardArea(value.toWhere)) return true;
    return side(value.fromWho) === perspectiveValue || side(value.toWho) === perspectiveValue;
  }
  return true;
}

for (const [index, line] of lines.entries()) {
  const record = JSON.parse(line) as Record<string, unknown>;
  if (record.kind === "session") {
    if (record.perspective === 0 || record.perspective === 1) perspective = record.perspective;
    continue;
  }
  if (record.kind === "error") {
    errors += 1;
    continue;
  }
  if (record.kind !== "notification" && record.kind !== "frame") continue;
  notifications += 1;
  const sequence = Number(record.sequence ?? index + 1);
  assert(Number.isSafeInteger(sequence), `invalid sequence at line ${index + 1}`);
  assert(sequence > previousSequence, `non-increasing sequence at line ${index + 1}`);
  previousSequence = sequence;
  if (record.terminal === true) terminal += 1;
  const state = record.state as Record<string, unknown>;
  lastPhase = state?.phase;
  const players = Array.isArray(state?.player) ? state.player as Array<Record<string, unknown>> : [];
  const opponent = players[1 - perspective];
  for (const zone of ["handCard", "pileCard"]) {
    for (const card of (Array.isArray(opponent?.[zone]) ? opponent[zone] : []) as Array<Record<string, unknown>>) {
      if (Number(card.definitionId) !== 0) maskedStateLeaks += 1;
    }
  }
  const mutations = Array.isArray(record.mutation) ? record.mutation : [];
  for (const rawMutation of mutations) {
    const parsed = mutationCase(rawMutation);
    if (!parsed) continue;
    bump(mutationCounts, parsed.name);
    let who: Side | undefined;
    let definition: number | undefined;
    let kind: "played" | "discarded" | "tuned" | "transferred" | undefined;
    if (parsed.name === "removeEntity") {
      if (!(parsed.value.where === "hands" || parsed.value.where === "hand" || parsed.value.where === 5 || parsed.value.where === "pile" || parsed.value.where === 6)) continue;
      if (!mutationDefinitionIsVisible(perspective, parsed.name, parsed.value)) continue;
      who = side(parsed.value.who);
      definition = definitionId(parsed.value.entity);
      const rawReason = parsed.value.reason;
      const reason = Number(rawReason);
      const reasonName = String(rawReason ?? "").toUpperCase().replace(/[^A-Z]/g, "");
      kind = reasonName === "EVENTCARDPLAYED" || reasonName === "EVENTCARDPLAYNOEFFECT"
        || reasonName === "EQUIPOVERRIDDEN" || reasonName === "CREATESUPPORTOVERRIDDEN"
        || reason === 1 || reason === 5 || reason === 7 || reason === 8
        ? "played"
        : reasonName === "ELEMENTALTUNING" || reason === 2 ? "tuned" : "discarded";
    } else if (parsed.name === "moveEntity" && isHandArea(parsed.value.fromWhere) && isBoardArea(parsed.value.toWhere)) {
      if (!mutationDefinitionIsVisible(perspective, parsed.name, parsed.value)) continue;
      who = side(parsed.value.fromWho ?? parsed.value.toWho);
      definition = definitionId(parsed.value.entity);
      kind = "played";
    } else if (parsed.name === "moveEntity"
      && isCardArea(parsed.value.fromWhere) && isCardArea(parsed.value.toWhere)
      && side(parsed.value.fromWho) !== undefined && side(parsed.value.toWho) !== undefined
      && parsed.value.fromWho !== parsed.value.toWho) {
      if (!mutationDefinitionIsVisible(perspective, parsed.name, parsed.value)) continue;
      who = side(parsed.value.fromWho);
      definition = definitionId(parsed.value.entity);
      kind = "transferred";
    }
    if (who === undefined || definition === undefined || !kind) continue;
    const key = `${who}:${definition}`;
    const current = expected.get(key) ?? { played: 0, discarded: 0, tuned: 0, transferred: 0 };
    current[kind] += 1;
    verifiedCardEvents[kind] += 1;
    expected.set(key, current);
  }
  const snapshot = engine.apply(frameFromNotification(sequence, perspective, state, mutations));
  for (const who of [0, 1] as const) {
    const player = players[who];
    if (Array.isArray(player?.handCard)) {
      assert.equal(snapshot.sides[who].handCount, player.handCard.length, `hand count mismatch for side ${who} at sequence ${sequence}`);
    }
    if (Array.isArray(player?.pileCard)) {
      assert.equal(snapshot.sides[who].deckCount, player.pileCard.length, `pile count mismatch for side ${who} at sequence ${sequence}`);
    }
  }
  for (const card of snapshot.sides[1 - perspective].knownHand) {
    if (card.definitionId !== 0) maskedSnapshotLeaks += 1;
  }
}

const snapshot = engine.snapshot();
const rows = new Map(snapshot.cards.map((row) => [`${row.side}:${row.definitionId}`, row]));
const cardImagePattern = /^https:\/\/static-data\.piovium\.org\/api\/v4\/image\/\d+\?thumbnail=(?:true|false)&type=cardFace$/;
for (const row of snapshot.cards) {
  assert(cardImagePattern.test(row.imageUrl ?? ""), `missing valid card image for ${row.side}:${row.definitionId}`);
}
for (const [key, counts] of expected) {
  const row = rows.get(key);
  assert(row, `missing ledger row for ${key}`);
  assert.equal(row.playedCount, counts.played, `played mismatch for ${key}`);
  assert.equal(row.discardedCount, counts.discarded, `discarded mismatch for ${key}`);
  assert.equal(row.tunedCount, counts.tuned, `tuned mismatch for ${key}`);
  assert.equal(row.transferredCount, counts.transferred, `transferred mismatch for ${key}`);
}
// Also check the reverse direction. A one-sided assertion can miss an engine
// bug that invents an extra event for a card that never appeared in the
// visible mutation stream, or double-counts a card transition. Every non-zero
// ledger counter in the four externally auditable categories must have an
// exact visible-mutation explanation.
for (const row of snapshot.cards) {
  const counts = expected.get(`${row.side}:${row.definitionId}`)
    ?? { played: 0, discarded: 0, tuned: 0, transferred: 0 };
  assert.equal(row.playedCount, counts.played, `unexpected played count for ${row.side}:${row.definitionId}`);
  assert.equal(row.discardedCount, counts.discarded, `unexpected discarded count for ${row.side}:${row.definitionId}`);
  assert.equal(row.tunedCount, counts.tuned, `unexpected tuned count for ${row.side}:${row.definitionId}`);
  assert.equal(row.transferredCount, counts.transferred, `unexpected transferred count for ${row.side}:${row.definitionId}`);
}
assert.equal(errors, 0, "trace contains simulator errors");
assert.equal(maskedStateLeaks, 0, "opponent hand/pile leaked a definition id");
assert.equal(maskedSnapshotLeaks, 0, "tracker snapshot named an opponent hidden hand card");
assert(terminal >= 1, "trace does not contain a terminal notification");
assert(lastPhase === 5 || lastPhase === "gameEnd", "trace does not end in GAME_END");

console.log(JSON.stringify({
  ok: true,
  trace: tracePath,
  perspective,
  notifications,
  terminal,
  lastPhase,
  errors,
  maskedStateLeaks,
  maskedSnapshotLeaks,
  verifiedCardEvents,
  mutationCounts: Object.fromEntries([...mutationCounts].sort()),
  verifiedExposedCardTransitions: expected.size,
  finalSequence: snapshot.sequence,
  warnings: snapshot.warnings.length,
}, null, 2));
