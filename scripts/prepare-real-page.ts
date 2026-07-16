import { readFile } from "node:fs/promises";

type Target = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpMessage = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const cdpUrl = (process.env.TRACKER_CDP_URL ?? "http://127.0.0.1:9332").replace(/\/$/, "");
const targetIncludes = process.env.TRACKER_CDP_TARGET_INCLUDES ?? "about:blank";
const credentialsPath = process.env.TRACKER_REAL_ROOM_CREDENTIALS;
const credentials = credentialsPath
  ? JSON.parse(await readFile(credentialsPath, "utf8")) as {
      roomId?: number;
      host?: { playerId?: string; accessToken?: string };
      opponent?: { playerId?: string; accessToken?: string };
    }
  : undefined;
const pageRole = process.env.TRACKER_PAGE_ROLE ?? "host";
const pageCredential = credentials?.[pageRole as "host" | "opponent"];
const pageUrl = process.env.TRACKER_PAGE_URL ?? (
  credentials && Number.isSafeInteger(credentials.roomId) && pageCredential?.playerId
    ? `https://amechan.7shengzhaohuan.online/rooms/${credentials.roomId}?player=${encodeURIComponent(pageCredential.playerId)}&action=1`
    : undefined
);
const accessToken = process.env.TRACKER_PAGE_ACCESS_TOKEN ?? pageCredential?.accessToken;
if (!pageUrl) throw new Error("Missing TRACKER_PAGE_URL or complete TRACKER_REAL_ROOM_CREDENTIALS");
if (!accessToken) throw new Error("Missing TRACKER_PAGE_ACCESS_TOKEN or page credential in TRACKER_REAL_ROOM_CREDENTIALS");
const userscriptPath = process.env.TRACKER_USERSCRIPT_PATH ?? "scripts/room-sse-userscript.user.js";
const connectTimeoutMs = Number(process.env.TRACKER_CDP_CONNECT_TIMEOUT_MS ?? 15_000);
const readyTimeoutMs = Number(process.env.TRACKER_PAGE_READY_TIMEOUT_MS ?? 30_000);

async function findTarget(): Promise<Target> {
  const deadline = Date.now() + connectTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${cdpUrl}/json/list`);
    if (!response.ok) throw new Error(`CDP target listing failed with HTTP ${response.status}`);
    const targets = await response.json() as unknown;
    if (!Array.isArray(targets)) throw new Error("CDP target listing was not an array");
    const target = targets.find((candidate): candidate is Target => (
      candidate && typeof candidate === "object" && !Array.isArray(candidate) &&
      (candidate as Target).type === "page" &&
      typeof (candidate as Target).url === "string" &&
      (candidate as Target).url!.includes(targetIncludes) &&
      typeof (candidate as Target).webSocketDebuggerUrl === "string"
    ));
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No CDP page matched ${JSON.stringify(targetIncludes)}`);
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl!);
await new Promise<void>((resolve, reject) => {
  const onOpen = () => {
    socket.removeEventListener("error", onError);
    resolve();
  };
  const onError = () => {
    socket.removeEventListener("open", onOpen);
    reject(new Error("Unable to connect to the Chrome DevTools websocket"));
  };
  socket.addEventListener("open", onOpen, { once: true });
  socket.addEventListener("error", onError, { once: true });
});

let nextId = 1;
const pending = new Map<number, {
  resolve: (message: CdpMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as CdpMessage;
  if (message.id === undefined) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message ?? "CDP command failed"));
  else request.resolve(message);
});

function send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const userscript = await readFile(userscriptPath, "utf8");
const gmStub = `
globalThis.GM_xmlhttpRequest = (options) => {
  fetch(options.url, {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.data,
  }).then(async (response) => {
    options.onload?.({ status: response.status, responseText: await response.text() });
  }).catch((error) => options.onerror?.(error));
};
`;
const source = `${gmStub}\n${userscript}`;
const tokenScript = `localStorage.setItem("accessToken", ${JSON.stringify(accessToken)});`;
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `${tokenScript}\n${source}` });
await send("Page.navigate", { url: pageUrl });

const deadline = Date.now() + readyTimeoutMs;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await send("Runtime.evaluate", {
      expression: `JSON.stringify({ready:document.readyState === "complete", app:Boolean(document.querySelector("#app")), pageStream:window.__GI_TCG_TRACKER_PAGE_STREAM_INSTALLED__ === true})`,
      returnByValue: true,
    });
    const value = (response.result?.result as { value?: string } | undefined)?.value;
    if (value) {
      const state = JSON.parse(value) as { ready?: boolean; app?: boolean; pageStream?: boolean };
      if (state.ready && state.app && state.pageStream) {
        ready = true;
        console.log(JSON.stringify({ ok: true, url: pageUrl, pageStreamInstalled: true }));
        break;
      }
    }
  } catch {
    // Navigation can briefly destroy the execution context; retry the target.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
socket.close();
if (!ready) {
  console.error(JSON.stringify({ ok: false, reason: "page did not become ready with page stream installed" }));
  process.exitCode = 1;
}
