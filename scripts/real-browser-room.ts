import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Deck = { characters: number[]; cards: number[] };
type GuestCredential = { playerId: string; accessToken: string };
type CreateRoomResponse = GuestCredential & { room: { id: number } };

const remoteBase = (process.env.TRACKER_REMOTE_BASE
  ?? "https://amechan.7shengzhaohuan.online/api").replace(/\/$/, "");
const hostDeckPath = resolve(process.env.TRACKER_BROWSER_HOST_DECK ?? "harness/decks/standard-a.json");
const opponentDeckPath = resolve(process.env.TRACKER_BROWSER_OPPONENT_DECK ?? hostDeckPath);
const outputPath = resolve(process.env.TRACKER_REAL_BROWSER_ROOM_OUT ?? "records/live/real-browser-room.json");
const gameVersion = Number(process.env.TRACKER_REMOTE_GAME_VERSION ?? 31);

if (process.env.TRACKER_ALLOW_REMOTE_ROOM !== "1") {
  console.log(JSON.stringify({
    ok: false,
    blocked: "set TRACKER_ALLOW_REMOTE_ROOM=1 to create and hold a temporary remote room",
  }));
  process.exit(2);
}

function assertDeck(value: unknown, label: string): Deck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.characters) || !Array.isArray(record.cards)) {
    throw new Error(`${label} must contain characters and cards arrays`);
  }
  return {
    characters: record.characters.map(Number),
    cards: record.cards.map(Number),
  };
}

async function readDeck(path: string, label: string): Promise<Deck> {
  return assertDeck(JSON.parse(await readFile(path, "utf8")), label);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 500)}`);
  return JSON.parse(body) as T;
}

function credential(value: unknown, label: string): GuestCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned a non-object response`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.playerId !== "string" || typeof record.accessToken !== "string") {
    throw new Error(`${label} response did not contain playerId/accessToken`);
  }
  return { playerId: record.playerId, accessToken: record.accessToken };
}

const hostDeck = await readDeck(hostDeckPath, "host deck");
const opponentDeck = await readDeck(opponentDeckPath, "opponent deck");
let host: CreateRoomResponse | undefined;
let cleaned = false;

async function giveUp(): Promise<number | undefined> {
  if (!host || cleaned) return undefined;
  cleaned = true;
  const response = await fetch(
    `${remoteBase}/rooms/${host.room.id}/players/${encodeURIComponent(host.playerId)}/giveUp`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${host.accessToken}` },
    },
  );
  return response.status;
}

const stop = new Promise<void>((resolveStop) => {
  let stopping = false;
  const finish = () => {
    if (stopping) return;
    stopping = true;
    resolveStop();
  };
  process.once("SIGINT", finish);
  process.once("SIGTERM", finish);
});
// A bare unresolved promise does not keep Node's event loop alive. Keep one
// low-frequency timer until the browser verification is finished, so SIGINT /
// SIGTERM can reliably reach the authenticated cleanup in the finally block.
const holdTimer = setInterval(() => undefined, 60_000);

try {
  host = await requestJson<CreateRoomResponse>(`${remoteBase}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameVersion,
      hostFirst: true,
      initTotalActionTime: 60,
      rerollTime: 120,
      roundTotalActionTime: 60,
      actionTime: 120,
      randomSeed: Number(process.env.TRACKER_REMOTE_RANDOM_SEED ?? 1),
      private: false,
      watchable: true,
      allowGuest: true,
      name: process.env.TRACKER_BROWSER_ROOM_NAME ?? "GI-TCG tracker browser acceptance",
      deck: hostDeck,
    }),
  });
  const roomId = host.room?.id;
  if (!Number.isSafeInteger(roomId) || roomId <= 0) throw new Error("create-room returned an invalid room id");

  const joined = await requestJson<unknown>(`${remoteBase}/rooms/${roomId}/players`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: process.env.TRACKER_BROWSER_OPPONENT_NAME ?? "GI-TCG tracker browser opponent",
      deck: opponentDeck,
    }),
  });
  const opponent = credential(joined, "join-room");
  const evidence = {
    createdAt: new Date().toISOString(),
    roomId,
    roomUrl: `https://amechan.7shengzhaohuan.online/rooms/${roomId}?player=${encodeURIComponent(host.playerId)}`,
    remoteBase,
    host: { playerId: host.playerId, accessToken: host.accessToken },
    opponent,
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: true,
    roomId,
    roomUrl: evidence.roomUrl,
    credentialsPath: outputPath,
    cleanup: "SIGINT/SIGTERM -> authenticated giveUp",
  }));
  await stop;
} finally {
  clearInterval(holdTimer);
  if (host) {
    try {
      console.log(JSON.stringify({ cleanup: { method: "giveUp", status: await giveUp() } }));
    } catch (error) {
      console.error(JSON.stringify({ cleanup: { method: "giveUp", error: String(error) } }));
      process.exitCode = 1;
    }
  }
}
