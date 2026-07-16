import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadCatalog } from "../src/catalog.ts";
import { loadDeck } from "../src/decks.ts";
import { startServer } from "../src/server.ts";
import { loadTrace } from "../src/trace.ts";
import type { TrackerSnapshot } from "../src/types.ts";

const root = resolve(".");
const port = Math.max(1, Number(process.env.TRACKER_LIVE_SIMULATOR_PORT ?? 8787));
const base = `http://127.0.0.1:${port}`;
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  TRACKER_SIMULATOR_INGEST_BASE: base,
  TRACKER_SIMULATOR_GAMES: process.env.TRACKER_SIMULATOR_GAMES ?? "1",
  TRACKER_TRACE_DIR: process.env.TRACKER_TRACE_DIR ?? "records/live-simulator",
};

const server = await startServer({ host: "127.0.0.1", port });
let childOutput = "";
const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/generate-simulator-trace.ts"], {
  cwd: root,
  env: childEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { childOutput += String(chunk); });
child.stderr.on("data", (chunk) => { childOutput += String(chunk); });

const exitCode = await new Promise<number>((resolvePromise, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
});

const health = await (await fetch(`${base}/api/health`)).json();
const states = await Promise.all([0, 1].map(async (perspective) => {
  const response = await fetch(`${base}/api/state?perspective=${perspective}`);
  return await response.json() as Record<string, unknown>;
}));
const traceDir = resolve(String(childEnvironment.TRACKER_TRACE_DIR));
const traceFiles = (await readdir(traceDir)).filter((file) => file.endsWith(".jsonl")).sort();
const latestTraceFor = (perspective: number): string | undefined => traceFiles
  .filter((file) => file.endsWith(`-p${perspective}.jsonl`))
  .at(-1);
const catalog = await loadCatalog(resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json"));
const deck0 = await loadDeck(resolve(childEnvironment.TRACKER_SIMULATOR_DECK0 ?? "harness/decks/standard-a.json"));
const deck1 = await loadDeck(resolve(childEnvironment.TRACKER_SIMULATOR_DECK1 ?? "harness/decks/standard-b.json"));
const offline = await Promise.all([0, 1].map(async (perspective) => {
  const trace = latestTraceFor(perspective);
  return trace ? await loadTrace(resolve(traceDir, trace), { catalog, decks: [deck0, deck1] }) : undefined;
}));
const projection = (state: Record<string, unknown> | TrackerSnapshot): unknown => {
  const value = state as Record<string, unknown>;
  return {
    phase: value.phase,
    roundNumber: value.roundNumber,
    currentTurn: value.currentTurn,
    winner: value.winner,
    sides: value.sides,
    cards: value.cards,
    warnings: value.warnings,
  };
};
const consistency = states.map((state, perspective) => ({
  perspective,
  trace: latestTraceFor(perspective),
  liveSequence: state.sequence,
  replaySequence: offline[perspective]?.sequence,
  sameProjection: offline[perspective] !== undefined && isDeepStrictEqual(projection(state), projection(offline[perspective]!)),
}));
await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));

const result = {
  ok: exitCode === 0
    && states.every((state) => Array.isArray(state.warnings) && state.warnings.length === 0)
    && consistency.every((item) => item.sameProjection),
  exitCode,
  health,
  consistency,
  states: states.map((state) => ({
    perspective: state.perspective,
    sequence: state.sequence,
    phase: state.phase,
    cards: Array.isArray(state.cards) ? state.cards.length : 0,
    events: Array.isArray(state.events) ? state.events.length : 0,
    warnings: state.warnings,
  })),
  childOutput: childOutput.trim().split(/\r?\n/).slice(-12),
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = exitCode || 1;
