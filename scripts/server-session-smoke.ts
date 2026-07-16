import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server.ts";

const server = await startServer({ host: "127.0.0.1", port: 0 });
const address = server.address() as AddressInfo;
const base = `http://127.0.0.1:${address.port}`;
const post = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};
const notification = { state: { phase: 3, player: [] }, mutation: [] };

try {
  const firstSession = await post("/api/session", {
    perspective: 0,
    sessionId: "page-a",
    replace: true,
    deck: { characters: [1411, 1510, 2103], cards: [333001, 333001, 333002] },
    opponentDeck: { characters: [1412, 1511, 2104], cards: [333002, 333002, 333001] },
  });
  assert.equal(firstSession.status, 200);
  assert.equal(firstSession.body.liveDeck, true);
  assert.equal(firstSession.body.liveOpponentDeck, true);
  assert.equal((await post("/api/ingest", { perspective: 0, sessionId: "page-a", notification })).body.sequence, 1);
  const heartbeat = await post("/api/session", { perspective: 0, sessionId: "page-a", heartbeat: true });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.action, "heartbeat");
  const replacement = await post("/api/session", { perspective: 0, sessionId: "page-b", replace: true });
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.action, "replace");
  const stale = await post("/api/ingest", { perspective: 0, sessionId: "page-a", notification });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.accepted, false);
  const waiting = await (await fetch(`${base}/api/state?perspective=0`)).json() as { sequence: number; warnings: string[] };
  assert.equal(waiting.sequence, 0);
  assert.match(waiting.warnings.join("\n"), /等待 live 首帧/);
  assert.equal((await post("/api/ingest", { perspective: 0, sessionId: "page-b", notification })).body.sequence, 1);
  const liveState = await (await fetch(`${base}/api/state?perspective=0`)).json() as { sides: Array<{ knownDeck: boolean }> };
  const expectedLiveDecks = [Boolean(process.env.TRACKER_LIVE_DECK0), Boolean(process.env.TRACKER_LIVE_DECK1)];
  assert.equal(liveState.sides[0]?.knownDeck, expectedLiveDecks[0]);
  assert.equal(liveState.sides[1]?.knownDeck, expectedLiveDecks[1]);
  let expired: boolean | undefined;
  if (process.env.TRACKER_TEST_LIVE_SESSION_EXPIRY === "1") {
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const health = await (await fetch(`${base}/api/health`)).json() as { livePerspectives?: unknown[] };
    expired = Array.isArray(health.livePerspectives) && health.livePerspectives.length === 0;
    assert.equal(expired, true);
  }
  console.log(JSON.stringify({ ok: true, first: firstSession.body, replacement: replacement.body, stale: stale.body, waiting: { sequence: waiting.sequence, warnings: waiting.warnings }, freshSequence: 1, liveDecks: liveState.sides.map((side) => side.knownDeck), expired }));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
