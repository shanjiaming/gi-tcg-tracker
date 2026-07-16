import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const tracePath = resolve(process.argv[2] ?? process.env.TRACKER_TRACE ?? "records/simulator/game-20260715-p0.jsonl");
const port = Number(process.env.TRACKER_FIXTURE_PORT ?? 8899);
const intervalMs = Math.max(0, Number(process.env.TRACKER_FIXTURE_INTERVAL_MS ?? 2));
const fixtureLimit = Number(process.env.TRACKER_FIXTURE_LIMIT ?? 0);
const includeTerminal = process.env.TRACKER_FIXTURE_INCLUDE_LAST === "1";
const useUserscript = process.env.TRACKER_FIXTURE_USE_USERSCRIPT === "1";
const unterminatedLast = process.env.TRACKER_FIXTURE_UNTERMINATED_LAST === "1";
const localDeckPath = process.env.TRACKER_FIXTURE_DECK;
const opponentDeckPath = process.env.TRACKER_FIXTURE_OPPONENT_DECK;
const localDeck = localDeckPath ? JSON.parse(await readFile(resolve(localDeckPath), "utf8")) : undefined;
const opponentDeck = opponentDeckPath ? JSON.parse(await readFile(resolve(opponentDeckPath), "utf8")) : undefined;
const records = (await readFile(tracePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Record<string, unknown>)
  .filter((record) => record.kind === "notification");
const replayRecords = Number.isSafeInteger(fixtureLimit) && fixtureLimit > 0 && fixtureLimit < records.length
  ? !includeTerminal
    ? records.slice(0, fixtureLimit)
    : fixtureLimit === 1
    ? records.slice(-1)
    : [...records.slice(0, fixtureLimit - 1), ...records.slice(-1)]
  : records;
let streamStarted = false;

const html = `<!doctype html>
<meta charset="utf-8" />
<title>Local GI-TCG room fixture</title>
<p id="status">local room fixture running</p>
<script>
${useUserscript
  ? `window.GM_xmlhttpRequest = (options) => {
  fetch(options.url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.data,
  }).then(async (response) => options.onload?.({ status: response.status, responseText: await response.text() }))
    .catch(() => options.onerror?.());
};
const userscript = document.createElement("script");
userscript.textContent = ${JSON.stringify(await readFile(resolve("scripts/room-sse-userscript.user.js"), "utf8"))};
document.head.appendChild(userscript);
userscript.remove();
document.getElementById("status").textContent = "userscript loaded";`
  : `const bridge = document.createElement("script");
bridge.src = "http://127.0.0.1:8787/bridge/room-sse-collector.js";
bridge.onload = () => { document.getElementById("status").textContent = "collector loaded"; };
bridge.onerror = () => { document.getElementById("status").textContent = "collector failed"; };
document.head.appendChild(bridge);`}
</script>`;

function sendSse(response: ServerResponse, payload: unknown, terminate = true): void {
  response.write(`data: ${JSON.stringify(payload)}${terminate ? "\n\n" : "\n"}`);
}

async function streamNotifications(response: ServerResponse): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
  sendSse(response, {
    type: "initialized",
    who: 0,
    ...(localDeck ? { myPlayerInfo: { deck: localDeck } } : {}),
    ...(opponentDeck ? { oppPlayerInfo: { deck: opponentDeck } } : {}),
  });
  // Model the real room stream's reconnect behavior: the first connection
  // gets the captured history, while later connections replay only the last
  // notification. This keeps the fixture deterministic and exercises the
  // bridge's reconnect deduplication without appending a second game.
  const sourceRecords = streamStarted ? replayRecords.slice(-1) : replayRecords;
  streamStarted = true;
  for (const [index, record] of sourceRecords.entries()) {
    if (response.writableEnded || response.destroyed) return;
    sendSse(response, {
      type: "notification",
      data: {
        state: record.state,
        mutation: Array.isArray(record.mutation) ? record.mutation : [],
      },
    }, !(unterminatedLast && index === sourceRecords.length - 1));
    if (intervalMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  response.end();
}

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/rooms/0042" || url.pathname === "/rooms/0042/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (url.pathname === "/api/rooms/42/players/p0/notification") {
    await streamNotifications(response);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("not found");
});

await new Promise<void>((resolvePromise) => server.listen(port, "127.0.0.1", resolvePromise));
console.log(JSON.stringify({ ok: true, fixture: "local-sse-room", tracePath, capturedRecords: records.length, records: replayRecords.length, port, intervalMs, useUserscript, unterminatedLast, localDeckPath, opponentDeckPath }));
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
