import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SseJsonParser } from "../src/live/notification.ts";

type Deck = { characters: number[]; cards: number[] };
type GuestRoom = {
  room: { id: number };
  playerId: string;
  accessToken: string;
};

const remoteBase = (process.env.TRACKER_REMOTE_BASE ?? "https://amechan.7shengzhaohuan.online/api").replace(/\/$/, "");
const localEndpoint = process.env.TRACKER_LOCAL_ENDPOINT ?? "http://127.0.0.1:8787/api/ingest";
const localSessionEndpoint = process.env.TRACKER_LOCAL_SESSION_URL ?? localEndpoint.replace(/\/ingest$/, "/session");
const localStateUrl = process.env.TRACKER_LOCAL_STATE_URL ?? "http://127.0.0.1:8787/api/state?perspective=0";
const deckPath = resolve(process.env.TRACKER_DECK ?? "harness/decks/standard-a.json");
const maxNotifications = Math.max(1, Number(process.env.TRACKER_REAL_SMOKE_NOTIFICATIONS ?? 1));
const timeoutMs = Math.max(1000, Number(process.env.TRACKER_REAL_SMOKE_TIMEOUT_MS ?? 15000));
const gameVersion = Number(process.env.TRACKER_REMOTE_GAME_VERSION ?? 31);

if (process.env.TRACKER_ALLOW_REMOTE_ROOM !== "1") {
  console.log(JSON.stringify({ ok: false, blocked: "set TRACKER_ALLOW_REMOTE_ROOM=1 to create a temporary remote room" }));
  process.exit(2);
}

const deck = JSON.parse(await readFile(deckPath, "utf8")) as Deck;

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

let created: GuestRoom | undefined;
let accepted: Array<Record<string, unknown>> = [];
let streamError: string | undefined;
let cleanupStatus: number | undefined;

try {
  created = await jsonRequest<GuestRoom>(`${remoteBase}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameVersion,
      hostFirst: true,
      initTotalActionTime: 20,
      rerollTime: 25,
      roundTotalActionTime: 20,
      actionTime: 25,
      randomSeed: Number(process.env.TRACKER_REMOTE_RANDOM_SEED ?? 1),
      private: true,
      watchable: false,
      allowGuest: true,
      name: "gi-tcg-tracker-smoke-p0",
      deck,
    }),
  });
  const roomId = created.room.id;
  const localSessionId = `real:${roomId}:${created.playerId}`;
  const opponent = await jsonRequest<{ playerId: string }>(`${remoteBase}/rooms/${roomId}/players`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "gi-tcg-tracker-smoke-p1", deck }),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${remoteBase}/rooms/${roomId}/players/${encodeURIComponent(created.playerId)}/notification`, {
      headers: {
        Accept: "text/event-stream",
        "cache-control": "no-cache",
        Authorization: `Bearer ${created.accessToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`notification stream HTTP ${response.status}`);
    const parser = new SseJsonParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let perspective: 0 | 1 | undefined;
    let done = false;
    while (!done && accepted.length < maxNotifications) {
      const next = await reader.read();
      if (next.done) break;
      for (const payload of parser.feed(decoder.decode(next.value, { stream: true }))) {
        const event = payload as { type?: string; who?: number; data?: { state?: unknown; mutation?: unknown[] } };
        if (event.type === "initialized") {
          perspective = event.who === 1 ? 1 : event.who === 0 ? 0 : undefined;
          if (perspective !== undefined) {
            await jsonRequest(localSessionEndpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ perspective, sessionId: localSessionId, replace: true }),
            });
          }
          continue;
        }
        if (event.type !== "notification" || perspective === undefined || event.data?.state === undefined) continue;
        const ingest = await jsonRequest<{ accepted?: boolean; sequence?: number; warnings?: string[] }>(localEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            perspective,
            sessionId: localSessionId,
            notification: event.data,
          }),
        });
        accepted.push({
          phase: (event.data.state as { phase?: unknown }).phase,
          mutationCount: Array.isArray(event.data.mutation) ? event.data.mutation.length : 0,
          accepted: ingest.accepted === true,
          sequence: ingest.sequence,
          warnings: ingest.warnings?.length ?? 0,
        });
        if (accepted.length >= maxNotifications) {
          done = true;
          controller.abort();
          break;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) streamError = String(error);
  } finally {
    clearTimeout(timeout);
  }
  let localState: Record<string, unknown> | undefined;
  try {
    localState = await jsonRequest<Record<string, unknown>>(localStateUrl, {});
  } catch (error) {
    streamError ??= `local state: ${String(error)}`;
  }
  console.log(JSON.stringify({
    ok: accepted.length > 0 && !streamError,
    roomId,
    playerId: created.playerId,
    opponentPlayerId: opponent.playerId,
    accepted,
    localState: localState && {
      sequence: localState.sequence,
      phase: localState.phase,
      roundNumber: localState.roundNumber,
      perspective: localState.perspective,
      warnings: Array.isArray(localState.warnings) ? localState.warnings.length : undefined,
    },
    streamError,
  }));
} finally {
  if (created) {
    const cleanup = await fetch(`${remoteBase}/rooms/${created.room.id}/players/${encodeURIComponent(created.playerId)}/giveUp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${created.accessToken}` },
    }).catch(() => undefined);
    cleanupStatus = cleanup?.status;
    console.log(JSON.stringify({ cleanup: { method: "giveUp", status: cleanupStatus } }));
  }
}
