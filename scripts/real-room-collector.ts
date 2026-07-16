import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SseJsonParser } from "../src/live/notification.ts";

type Side = 0 | 1;
type Guest = { playerId: string; accessToken: string };
type RoomCredentials = {
  roomId: number;
  host: Guest;
  opponent: Guest;
};

function integerEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function requireString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 500)}`);
  return JSON.parse(body) as T;
}

const credentialsPath = resolve(requireString(
  "TRACKER_REAL_ROOM_CREDENTIALS",
  "records/live/real-browser-room-current.json",
));
const evidencePath = resolve(requireString(
  "TRACKER_REAL_ROOM_COLLECTOR_OUT",
  `records/live/${Date.now()}-real-room-collector.json`,
));
const remoteBase = (process.env.TRACKER_REMOTE_BASE
  ?? "https://amechan.7shengzhaohuan.online/api").replace(/\/$/, "");
const localBase = (process.env.TRACKER_LOCAL_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const timeoutMs = integerEnv("TRACKER_REAL_ROOM_COLLECTOR_TIMEOUT_MS", 45_000, 1_000);
const maxNotifications = integerEnv("TRACKER_REAL_ROOM_COLLECTOR_MAX_NOTIFICATIONS", 10_000, 1);

const credentials = JSON.parse(await readFile(credentialsPath, "utf8")) as RoomCredentials;
if (!Number.isSafeInteger(credentials.roomId) || credentials.roomId <= 0) {
  throw new Error("credentials roomId is invalid");
}

const startedAt = Date.now();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const sessionId = `real-room-collector:${credentials.roomId}:${Date.now()}`;
const accepted: Array<Record<string, unknown>> = [];
let perspective: Side | undefined;
let streamInitialized = false;
let terminal = false;
let lastState: Record<string, unknown> | undefined;
let lastIngest: Record<string, unknown> | undefined;
let streamError: string | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

async function registerSession(event: Record<string, unknown>): Promise<void> {
  perspective = event.who === 1 ? 1 : event.who === 0 ? 0 : undefined;
  if (perspective === undefined) throw new Error("initialized event did not contain who=0|1");
  const myPlayerInfo = event.myPlayerInfo as Record<string, unknown> | undefined;
  const oppPlayerInfo = event.oppPlayerInfo as Record<string, unknown> | undefined;
  const result = await jsonRequest<Record<string, unknown>>(`${localBase}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      perspective,
      sessionId,
      replace: true,
      deck: myPlayerInfo?.deck,
      opponentDeck: oppPlayerInfo?.deck,
    }),
  });
  if (result.ok !== true) throw new Error(`local session rejected: ${JSON.stringify(result)}`);
  streamInitialized = true;
  heartbeatTimer = setInterval(() => {
    void jsonRequest<Record<string, unknown>>(`${localBase}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ perspective, sessionId, heartbeat: true }),
    }).catch((error) => {
      streamError ??= `local heartbeat: ${String(error)}`;
    });
  }, 5_000);
}

async function ingest(notification: unknown): Promise<void> {
  if (perspective === undefined) throw new Error("notification arrived before initialized");
  const payload = notification as { state?: Record<string, unknown>; mutation?: unknown[] };
  if (!payload.state || typeof payload.state !== "object") return;
  lastState = payload.state;
  const result = await jsonRequest<Record<string, unknown>>(`${localBase}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ perspective, sessionId, notification: payload }),
  });
  lastIngest = result;
  accepted.push({
    sequence: result.sequence,
    accepted: result.accepted,
    phase: payload.state.phase,
    roundNumber: payload.state.roundNumber,
    mutationCount: Array.isArray(payload.mutation) ? payload.mutation.length : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
  });
  if (payload.state.phase === 5 || payload.state.phase === "gameEnd") terminal = true;
}

try {
  const guest = credentials.host;
  const response = await fetch(
    `${remoteBase}/rooms/${credentials.roomId}/players/${encodeURIComponent(guest.playerId)}/notification`,
    {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${guest.accessToken}` },
      signal: controller.signal,
    },
  );
  if (!response.ok || !response.body) throw new Error(`notification stream HTTP ${response.status}`);
  const parser = new SseJsonParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  while (!terminal && accepted.length < maxNotifications) {
    const next = await reader.read();
    if (next.done) break;
    for (const event of parser.feed(decoder.decode(next.value, { stream: true }))) {
      if (!event || typeof event !== "object") continue;
      const payload = event as Record<string, unknown>;
      if (payload.type === "initialized") await registerSession(payload);
      else if (payload.type === "notification") await ingest(payload.data);
      if (terminal || accepted.length >= maxNotifications) break;
    }
  }
} catch (error) {
  if (!(error instanceof DOMException && error.name === "AbortError")) streamError = String(error);
} finally {
  clearTimeout(timeout);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}

const state = await fetch(`${localBase}/api/state?perspective=${perspective ?? 0}`, { cache: "no-store" })
  .then(async (response) => response.ok ? await response.json() as Record<string, unknown> : undefined)
  .catch(() => undefined);
const stateCards = state && Array.isArray(state.cards)
  ? state.cards.filter((card): card is Record<string, unknown> => Boolean(card) && typeof card === "object" && !Array.isArray(card))
  : [];
const localSide = perspective ?? 0;
const evidence = {
  ok: streamInitialized && accepted.length > 0 && !streamError,
  createdAt: new Date().toISOString(),
  roomId: credentials.roomId,
  perspective,
  sessionId,
  elapsedMs: Date.now() - startedAt,
  streamInitialized,
  notifications: accepted.length,
  terminal,
  lastIngest,
  lastState: lastState ? {
    phase: lastState.phase,
    roundNumber: lastState.roundNumber,
    winner: lastState.winner,
  } : undefined,
  localState: state ? {
    sequence: state.sequence,
    phase: state.phase,
    roundNumber: state.roundNumber,
    warnings: Array.isArray(state.warnings) ? state.warnings : [],
    cardCount: stateCards.length,
    imageCardCount: stateCards.filter((card) => typeof card.imageUrl === "string").length,
    localDeckRows: stateCards.filter((card) => Number(card.side) === localSide && Number(card.remainingCount) > 0).length,
    localPlayedRows: stateCards.filter((card) => Number(card.side) === localSide && Number(card.playedCount) > 0).length,
    opponentPlayedRows: stateCards.filter((card) => Number(card.side) !== localSide && Number(card.playedCount) > 0).length,
    opponentUnplayedRows: stateCards.filter((card) => Number(card.side) !== localSide && Number(card.unplayedCount) > 0).length,
  } : undefined,
  acceptedTail: accepted.slice(-20),
  streamError,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
if (!evidence.ok) process.exitCode = 1;
