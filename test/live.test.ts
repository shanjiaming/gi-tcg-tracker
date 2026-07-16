import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { NotificationSequencer, SseJsonParser } from "../src/live/notification.ts";
import { frameFromNotification } from "../src/normalize.ts";
import {
  cacheBySide,
  DASHBOARD,
  decideLiveSession,
  isLiveSessionFresh,
  resolveLiveSessionTimeoutMs,
  resolveReplayTracePath,
} from "../src/server.ts";

test("SSE parser handles split JSON data events", () => {
  const parser = new SseJsonParser();
  assert.deepEqual(parser.feed("data: {\"type\":\"ping\"}\n\n"), [{ type: "ping" }]);
  assert.deepEqual(parser.feed("data: {\"type\":\"noti"), []);
  assert.deepEqual(parser.feed("fication\",\"data\":1}\n\n"), [{ type: "notification", data: 1 }]);
});

test("SSE parser flushes an unterminated final data event", () => {
  const parser = new SseJsonParser();
  assert.deepEqual(parser.feed("data: {\"type\":\"notification\",\"data\":42}\n"), []);
  assert.deepEqual(parser.flush(), [{ type: "notification", data: 42 }]);
});

test("notification sequencer drops reconnect replay without inventing a frame", () => {
  const sequencer = new NotificationSequencer();
  const notification = { state: { phase: 3, player: [] }, mutation: [] };
  const first = sequencer.next(0, notification);
  const duplicate = sequencer.next(0, notification);
  const second = sequencer.next(0, { state: { phase: 4, player: [] }, mutation: [] });
  assert.equal(first?.sequence, 1);
  assert.equal(duplicate, undefined);
  assert.equal(second?.sequence, 2);
});

test("notification sequencer fails closed on a non-array mutation payload", () => {
  const sequencer = new NotificationSequencer();
  const frame = sequencer.next(0, { state: { phase: 3, player: [] }, mutation: { invalid: true } as never });
  assert.equal(frame?.sequence, 1);
  assert.deepEqual(frame?.mutations, []);
});

test("notification sequencer rejects malformed state without consuming sequence", () => {
  const sequencer = new NotificationSequencer();
  assert.equal(sequencer.next(0, { state: null }), undefined);
  assert.equal(sequencer.next(0, { state: [] as never }), undefined);
  assert.equal(sequencer.next(0, { state: "not-a-state" as never }), undefined);
  assert.equal(sequencer.next(0, { state: { phase: 3, player: {} } as never }), undefined);
  const valid = sequencer.next(0, { state: { phase: 3, player: [] }, mutation: [] });
  assert.equal(valid?.sequence, 1);
});

test("notification sequencer rejects malformed entity arrays without clearing state", () => {
  const sequencer = new NotificationSequencer();
  assert.equal(sequencer.next(0, { state: { phase: 3, player: [{ handCard: [null] }] } as never }), undefined);
  assert.equal(sequencer.next(0, { state: { phase: 3, player: [{ combatStatus: "bad" }] } as never }), undefined);
  const valid = sequencer.next(0, { state: { phase: 3, player: [] }, mutation: [] });
  assert.equal(valid?.sequence, 1);
});

test("direct notification normalization fails closed on non-object state", () => {
  const frame = frameFromNotification(1, 0, null);
  assert.deepEqual(frame.state.player, {});
});

test("replay fallback follows the requested public perspective", () => {
  assert.equal(resolveReplayTracePath("/tmp/game-p0.jsonl", 1), "/tmp/game-p1.jsonl");
  assert.equal(resolveReplayTracePath("/tmp/custom-trace.jsonl", 1), undefined);
  assert.equal(resolveReplayTracePath("/tmp/custom-trace.jsonl", 0), "/tmp/custom-trace.jsonl");
  assert.equal(resolveReplayTracePath("/tmp/game-p0.jsonl", 1, "/tmp/other-p1.jsonl"), "/tmp/other-p1.jsonl");
});

test("dashboard inline script is syntactically valid", () => {
  const script = DASHBOARD.match(/<script>\n([\s\S]*)\n<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /safeImageUrl/);
  assert.match(script, /card\.imageUrl/);
  assert.match(script, /esc\(card\.name/);
  assert.match(DASHBOARD, /我打出的牌/);
  assert.match(DASHBOARD, /我牌库中的牌/);
  assert.match(DASHBOARD, /对手打出的牌/);
  assert.match(DASHBOARD, /对手未打出的牌/);
});

test("dashboard runtime escapes untrusted snapshot strings", async () => {
  const script = DASHBOARD.match(/<script>\n([\s\S]*)\n<\/script>/)?.[1];
  assert.ok(script);
  const ids = ["meta", "warnings", "local-played-note", "local-played", "local-deck-note", "local-deck", "opponent-played-note", "opponent-played", "opponent-unplayed-note", "opponent-unplayed", "refresh"];
  const elements = new Map(ids.map((id) => [id, { innerHTML: "", textContent: "" }]));
  const attack = "<img src=x onerror=alert(1)>";
  const snapshot = {
    sequence: 1,
    roundNumber: 1,
    phase: attack,
    currentTurn: 0,
    perspective: 0,
    sides: [
      {
        side: 0,
        knownDeck: true,
        handCount: attack,
        deckCount: 2,
        knownHand: [{ name: attack }],
        knownPile: [],
        characters: [{ name: attack, health: attack, maxHealth: 10, energy: 1, maxEnergy: 3 }],
      },
        { side: 1, knownDeck: true, handCount: 1, deckCount: 2, knownHand: [], knownPile: [], characters: [] },
    ],
    cards: [{ side: 0, name: attack, deckCount: attack, handCount: attack, remainingCount: attack,
      imageUrl: attack, playedCount: attack, discardedCount: 0, tunedCount: 0, transferredCount: 0, unknownExitCount: 0 }],
    events: [{ sequence: 1, kind: attack, reason: attack }],
    warnings: [attack],
  };
  runInNewContext(script, {
    document: { getElementById: (id: string) => elements.get(id) },
    fetch: async () => ({ json: async () => snapshot }),
    setInterval: () => 0,
    console: { log() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const rendered = [...elements.values()].map((element) => element.innerHTML).join("\n");
  assert.doesNotMatch(rendered, /<img\b|<svg\b|<script\b/i);
  assert.match(rendered, /&lt;img/);
});

test("dashboard renders card-face images for both requested lists", async () => {
  const script = DASHBOARD.match(/<script>\n([\s\S]*)\n<\/script>/)?.[1];
  assert.ok(script);
  const ids = ["meta", "warnings", "local-played-note", "local-played", "local-deck-note", "local-deck", "opponent-played-note", "opponent-played", "opponent-unplayed-note", "opponent-unplayed", "refresh"];
  const elements = new Map(ids.map((id) => [id, { innerHTML: "", textContent: "" }]));
  const image = "https://static-data.piovium.org/api/v4/image/333001?thumbnail=true&type=cardFace";
  const snapshot = {
    sequence: 4,
    roundNumber: 2,
    phase: 3,
    perspective: 0,
    sides: [
      { side: 0, knownDeck: true, knownHand: [], knownPile: [], characters: [] },
      { side: 1, knownDeck: true, knownHand: [], knownPile: [], characters: [] },
    ],
    cards: [
      { side: 0, definitionId: 333001, name: "绝云锅巴", imageUrl: image, remainingCount: 2, unplayedCount: 2, playedCount: 0 },
      { side: 1, definitionId: 333001, name: "绝云锅巴", imageUrl: image, remainingCount: 0, unplayedCount: 1, deckCount: 3, playedCount: 2 },
    ],
    warnings: [],
  };
  runInNewContext(script, {
    document: { getElementById: (id: string) => elements.get(id) },
    fetch: async () => ({ json: async () => snapshot }),
    setInterval: () => 0,
    console: { log() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.get("local-deck")?.innerHTML ?? "", /image\/333001\?thumbnail=true&amp;type=cardFace/);
  assert.match(elements.get("opponent-played")?.innerHTML ?? "", /已打出 2 张/);
  assert.match(elements.get("opponent-played")?.innerHTML ?? "", /image\/333001\?thumbnail=true&amp;type=cardFace/);
  assert.match(elements.get("opponent-unplayed")?.innerHTML ?? "", /尚未打出 1 张/);
});

test("live session replacement rejects stale reconnects", () => {
  assert.equal(decideLiveSession(undefined, "page-a", false), "activate");
  assert.equal(decideLiveSession("page-a", "page-a", false), "accept");
  assert.equal(decideLiveSession("page-a", "page-b", true), "replace");
  assert.equal(decideLiveSession("page-b", "page-a", false), "reject");
});

test("live session freshness expires without a heartbeat", () => {
  assert.equal(resolveLiveSessionTimeoutMs(undefined), 15_000);
  assert.equal(resolveLiveSessionTimeoutMs("500"), 15_000);
  assert.equal(resolveLiveSessionTimeoutMs("2000"), 2_000);
  assert.equal(isLiveSessionFresh(10_000, 12_000, 2_000), true);
  assert.equal(isLiveSessionFresh(10_000, 12_001, 2_000), false);
  assert.equal(isLiveSessionFresh(10_000, 9_999, 2_000), false);
});

test("replay loader caches concurrent requests per perspective", async () => {
  let calls = 0;
  const load = cacheBySide(async (perspective) => {
    calls += 1;
    await Promise.resolve();
    return perspective;
  });
  const [first, second, other] = await Promise.all([load(0), load(0), load(1)]);
  assert.deepEqual([first, second, other], [0, 0, 1]);
  assert.equal(calls, 2);
  assert.equal(await load(0), 0);
  assert.equal(calls, 2);
});
