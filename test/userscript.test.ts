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
  assert.match(source, /@run-at\s+document-start/);
  assert.match(source, /room-sse-collector\.js/);
  assert.match(source, /GM_xmlhttpRequest\(\{/);
  assert.match(source, /__GI_TCG_TRACKER_LOCAL_CHANNEL__/);
  assert.match(source, /blocked non-local tracker request/);
  assert.doesNotMatch(source, /actionResponse|click\s*\(|dispatchEvent|\.submit\s*\(/);
});

test("userscript tees the page-owned notification fetch and preserves the page response", async () => {
  const source = await readFile(userscriptPath, "utf8");
  let tapSource = "";
  const append = (node: Record<string, unknown>) => {
    if (node.dataset && (node.dataset as Record<string, unknown>).giTcgTracker === "page-stream-tap") {
      tapSource = String(node.textContent ?? "");
    }
  };
  const document = {
    head: { appendChild: append },
    documentElement: { appendChild: append },
    createElement() {
      return { dataset: {} as Record<string, unknown>, textContent: "", remove() {} };
    },
  };
  const pageMessages: unknown[] = [];
  const window = {
    addEventListener() {},
    postMessage(message: unknown) { pageMessages.push(message); },
  };
  runInNewContext(source, {
    window,
    document,
    location: { hostname: "amechan.7shengzhaohuan.online" },
    GM_xmlhttpRequest(options: { onload?: (response: unknown) => void }) {
      options.onload?.({ status: 200, responseText: "" });
    },
    console: { warn() {} },
  }, { filename: "room-sse-userscript.user.js" });
  assert.match(tapSource, /body\.tee\(\)/);
  assert.match(tapSource, /gi-tcg-tracker-page-stream/);

  const encoded = new TextEncoder().encode([
    { type: "initialized", who: 0 },
    { type: "notification", data: { state: { phase: 0 }, mutation: [] } },
  ].map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join(""));
  let read = false;
  const trackerBody = {
    getReader() {
      return {
        async read() {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: encoded };
        },
      };
    },
  };
  const pageBody = { page: true };
  const originalResponse = {
    status: 200,
    statusText: "OK",
    headers: {},
    body: { tee: () => [pageBody, trackerBody] },
  };
  class TestResponse {
    body: unknown;
    status: number;
    statusText: string;
    headers: unknown;
    constructor(body: unknown, init: { status: number; statusText: string; headers: unknown }) {
      this.body = body;
      this.status = init.status;
      this.statusText = init.statusText;
      this.headers = init.headers;
    }
  }
  const pageWindow: Record<string, unknown> = {
    fetch: async () => originalResponse,
    postMessage(message: unknown) { pageMessages.push(message); },
    __GI_TCG_TRACKER_PAGE_STREAM_QUEUE__: [],
  };
  runInNewContext(tapSource, {
    window: pageWindow,
    location: { href: "https://amechan.7shengzhaohuan.online/rooms/42" },
    URL,
    TextDecoder,
    Response: TestResponse,
    console: { warn() {} },
  }, { filename: "page-stream-tap.js" });
  const response = await (pageWindow.fetch as (url: string) => Promise<TestResponse>)
    ("https://amechan.7shengzhaohuan.online/api/rooms/42/players/p0/notification");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  assert.equal(response.body, pageBody);
  assert.deepEqual(
    (pageWindow.__GI_TCG_TRACKER_PAGE_STREAM_QUEUE__ as unknown[]).map((payload) => (payload as { type: string }).type),
    ["initialized", "notification"],
  );
  assert.equal(pageMessages.some((message) => (
    (message as { source?: string }).source === "gi-tcg-tracker-page-stream"
  )), true);

  let largeSequence = 0;
  const largeWindow: Record<string, unknown> = {
    fetch: async () => {
      const payload = largeSequence++ === 0
        ? { type: "initialized", who: 0 }
        : { type: "notification", data: { state: { phase: 0 }, mutation: [] } };
      const chunk = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
      let read = false;
      const trackerStream = {
        getReader() {
          return {
            async read() {
              if (read) return { done: true, value: undefined };
              read = true;
              return { done: false, value: chunk };
            },
          };
        },
      };
      return {
        status: 200,
        statusText: "OK",
        headers: {},
        body: { tee: () => [{ page: true }, trackerStream] },
      };
    },
    postMessage() {},
    __GI_TCG_TRACKER_PAGE_STREAM_QUEUE__: [],
  };
  runInNewContext(tapSource, {
    window: largeWindow,
    location: { href: "https://amechan.7shengzhaohuan.online/rooms/42" },
    URL,
    TextDecoder,
    Response: TestResponse,
    console: { warn() {} },
  }, { filename: "page-stream-tap-large-queue.js" });
  for (let index = 0; index < 300; index += 1) {
    await (largeWindow.fetch as (url: string) => Promise<unknown>)
      ("https://amechan.7shengzhaohuan.online/api/rooms/42/players/p0/notification");
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  const largeQueue = largeWindow.__GI_TCG_TRACKER_PAGE_STREAM_QUEUE__ as unknown[];
  assert.equal(largeQueue.length, 256);
  assert.equal(largeQueue.some((payload) => (payload as { type?: string }).type === "initialized"), true);
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

test("page stream fallback starts at most one direct SSE connection", async () => {
  const source = await readFile(collectorPath, "utf8");
  let notificationRequests = 0;
  let timerId = 0;
  const window = {
    __GI_TCG_TRACKER_CONFIG__: { overlay: false },
    __GI_TCG_TRACKER_PAGE_STREAM__: true,
    __GI_TCG_TRACKER_PAGE_STREAM_CHANNEL__: "page-channel",
    __GI_TCG_TRACKER_PAGE_STREAM_INSTALLED__: true,
    __GI_TCG_TRACKER_PAGE_STREAM_QUEUE__: [
      { type: "tapUnavailable" },
      { type: "tapUnavailable" },
      { type: "tapError", error: "synthetic" },
    ],
    addEventListener() {},
    removeEventListener() {},
    postMessage() {},
    setTimeout() { return ++timerId; },
    clearTimeout() {},
    setInterval() { return ++timerId; },
    clearInterval() {},
  } as Record<string, unknown>;
  const fetch = async (input: unknown) => {
    if (String(input).endsWith("/notification")) {
      notificationRequests += 1;
      return {
        ok: true,
        status: 200,
        body: { getReader: () => ({ async read() { return { done: true, value: undefined }; } }) },
      };
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  };
  const sandbox: Record<string, unknown> = {
    window,
    document: { body: undefined },
    location: {
      origin: "https://amechan.7shengzhaohuan.online",
      pathname: "/rooms/42",
      href: "https://amechan.7shengzhaohuan.online/rooms/42?player=p0",
    },
    localStorage: { getItem: () => null },
    crypto: { randomUUID: () => "fallback-test" },
    URL,
    fetch,
    TextDecoder,
    AbortController,
    console: { info() {}, warn() {} },
  };
  runInNewContext(source, sandbox, { filename: "room-sse-collector.js" });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  (window.__GI_TCG_TRACKER_BRIDGE__ as { stop(): void }).stop();
  assert.equal(notificationRequests, 1);
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
