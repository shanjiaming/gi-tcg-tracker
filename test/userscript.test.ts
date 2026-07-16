import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const userscriptPath = new URL("../scripts/room-sse-userscript.user.js", import.meta.url);
const collectorPath = new URL("../scripts/room-sse-collector.js", import.meta.url);
const fixturePath = new URL("../scripts/run-sse-fixture.ts", import.meta.url);

test("room userscript is packaged as a read-only bridge", async () => {
  const source = await readFile(userscriptPath, "utf8");
  assert.match(source, /@match\s+https:\/\/amechan\.7shengzhaohuan\.online\/rooms\/\*/);
  assert.match(source, /@match\s+https:\/\/beta\.amechan\.7shengzhaohuan\.online\/rooms\/\*/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
  assert.match(source, /@connect\s+127\.0\.0\.1/);
  assert.match(source, /room-sse-collector\.js/);
  assert.match(source, /GM_xmlhttpRequest\(\{/);
  assert.match(source, /__GI_TCG_TRACKER_LOCAL_CHANNEL__/);
  assert.match(source, /blocked non-local tracker request/);
  assert.doesNotMatch(source, /actionResponse|click\s*\(|dispatchEvent|\.submit\s*\(/);
});

test("userscript browser fixture preserves GM request method and body", async () => {
  const source = await readFile(fixturePath, "utf8");
  assert.match(source, /method: options\.method \|\| "GET"/);
  assert.match(source, /headers: options\.headers \|\| \{\}/);
  assert.match(source, /body: options\.data/);
});

test("page collector renders a scrollable read-only overlay and stays action-free", async () => {
  const source = await readFile(collectorPath, "utf8");
  assert.match(source, /gi-tcg-tracker-overlay/);
  assert.match(source, /if \(overlay && overlayBody && overlay\.parentNode\) return/);
  assert.match(source, /pointer-events:none/);
  assert.match(source, /height:min\(760px,calc\(100vh - 24px\)\)/);
  assert.match(source, /display:flex/);
  assert.match(source, /overflow-y:scroll/);
  assert.match(source, /scrollbar-color:#7f8db4 transparent/);
  assert.match(source, /addEventListener\("wheel"/);
  assert.match(source, /pointer-events:auto/);
  assert.match(source, /touch-action:pan-y/);
  assert.match(source, /记牌器内容，可滚动查看/);
  assert.match(source, /const preservedScrollTop = overlayBody\.scrollTop/);
  assert.match(source, /overlayBody\.scrollTop = Math\.min\(Math\.max\(0, preservedScrollTop\), maxScrollTop\)/);
  assert.match(source, /requestAnimationFrame\(restoreScrollTop\)/);
  assert.match(source, /正在连接雨酱房间 SSE/);
  assert.match(source, /SSE 连接失败，正在重试/);
  assert.match(source, /response\.status === 404/);
  assert.match(source, /房间不存在或当前玩家已离开，已停止重试/);
  assert.match(source, /hasRenderedSnapshot/);
  assert.match(source, /我打出的牌/);
  assert.match(source, /我牌库中的牌/);
  assert.match(source, /对手打出的牌/);
  assert.match(source, /对手未打出的牌/);
  assert.match(source, /knownPile/);
  assert.match(source, /safeImageUrl/);
  assert.match(source, /api\/session/);
  assert.match(source, /requestLocal/);
  assert.match(source, /gi-tcg-tracker-userscript/);
  assert.match(source, /local tracker transport timeout/);
  assert.match(source, /randomUUID/);
  assert.match(source, /sessionRegistrationAttempted/);
  assert.match(source, /myPlayerInfo\?\.deck/);
  assert.match(source, /oppPlayerInfo\?\.deck/);
  assert.match(source, /deck: localDeck/);
  assert.match(source, /opponentDeck/);
  assert.match(source, /waitForSession/);
  assert.match(source, /window\.setTimeout\(resolvePromise, 1000\)/);
  assert.match(source, /sessionRegistrationBlocked = true/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /live session 已被另一个页面接管/);
  assert.match(source, /encodeURIComponent\(playerId\)/);
  assert.match(source, /decoder\.decode\(\)\}/);
  assert.match(source, /setInterval\(\(\) => void pollState\(\), 1500\)/);
  assert.doesNotMatch(source, /actionResponse|\.click\s*\(|dispatchEvent|\.submit\s*\(/);
});

test("page collector waits for local session before forwarding same-chunk notification", async () => {
  const source = await readFile(collectorPath, "utf8");
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const notification = { state: { phase: 3, player: [] }, mutation: [] };
  const ssePayload = [
    { type: "initialized", who: 0, myPlayerInfo: { deck: { characters: [1411, 1510, 2103], cards: [333001, 333002] } }, oppPlayerInfo: { deck: { characters: [1412, 1511, 2104], cards: [333002, 333002, 333001] } } },
    { type: "notification", data: notification },
  ].map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  let sseRead = false;
  let sessionAttempts = 0;
  let ingests = 0;
  let timerId = 0;
  let heartbeatCallback: (() => void) | undefined;
  const sandbox: Record<string, unknown> = {};
  const fetch = async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    calls.push({ url, method, body: typeof init.body === "string" ? init.body : undefined });
    if (url.endsWith("/session")) {
      sessionAttempts += 1;
      return sessionAttempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
    }
    if (url.endsWith("/ingest")) {
      ingests += 1;
      return { ok: true, status: 200 };
    }
    if (url.endsWith("/state?perspective=0")) return { ok: true, status: 200, json: async () => ({ sequence: 1 }) };
    if (url.includes("/players/") && url.endsWith("/notification")) {
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            async read() {
              if (sseRead) return new Promise(() => {});
              sseRead = true;
              return { done: false, value: new TextEncoder().encode(ssePayload) };
            },
          }),
        },
      };
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const window = {
    __GI_TCG_TRACKER_CONFIG__: {
      overlay: false,
      endpoint: "http://127.0.0.1:8787/api/ingest",
      sessionEndpoint: "http://127.0.0.1:8787/api/session",
      stateEndpoint: "http://127.0.0.1:8787/api/state",
    },
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId;
      if (delay === 1000) queueMicrotask(callback);
      return id;
    },
    clearTimeout() {},
    setInterval(callback: () => void, delay: number) {
      if (delay === 5000) heartbeatCallback = callback;
      return ++timerId;
    },
    clearInterval() {},
  } as Record<string, unknown>;
  sandbox.window = window;
  Object.assign(sandbox, {
    window,
    document: {},
    location: {
      origin: "https://amechan.7shengzhaohuan.online",
      pathname: "/rooms/42",
      href: "https://amechan.7shengzhaohuan.online/rooms/42?player=p0",
    },
    localStorage: { getItem: () => null },
    crypto: { randomUUID: () => "page-test" },
    URL,
    fetch,
    TextDecoder,
    TextEncoder,
    AbortController,
    console: { info() {}, warn() {} },
  });
  runInNewContext(source, sandbox, { filename: "room-sse-collector.js" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(heartbeatCallback);
  await heartbeatCallback();
  (window.__GI_TCG_TRACKER_BRIDGE__ as { stop(): void }).stop();
  assert.equal(sessionAttempts, 3);
  assert.equal(ingests, 1);
  assert.deepEqual(calls.filter((call) => call.url.endsWith("/session")).map((call) => call.method), ["POST", "POST", "POST"]);
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith("/session"))?.body ?? "{}").deck, {
    characters: [1411, 1510, 2103],
    cards: [333001, 333002],
  });
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.endsWith("/session"))?.body ?? "{}").opponentDeck, {
    characters: [1412, 1511, 2104],
    cards: [333002, 333002, 333001],
  });
  assert.equal(calls.some((call) => JSON.parse(call.body ?? "{}").heartbeat === true), true);
  assert.equal(calls.some((call) => call.url.endsWith("/ingest")), true);
});
