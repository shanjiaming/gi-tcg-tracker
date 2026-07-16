import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Side = 0 | 1;

interface HealthResponse {
  ok?: boolean;
  project?: string;
  livePerspectives?: unknown;
  liveSessions?: Record<string, unknown>;
}

interface StateResponse {
  sequence?: unknown;
  perspective?: unknown;
  phase?: unknown;
  roundNumber?: unknown;
  warnings?: unknown;
}

interface LiveEvidence {
  ok: boolean;
  observedAt: string;
  baseUrl: string;
  perspective: Side;
  elapsedMs: number;
  health: HealthResponse;
  state: StateResponse;
}

function integerEnv(name: string, fallback: number, minimum: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function perspectiveEnv(): Side {
  const value = process.env.TRACKER_LIVE_ACCEPTANCE_PERSPECTIVE ?? "0";
  if (value !== "0" && value !== "1") {
    throw new Error("TRACKER_LIVE_ACCEPTANCE_PERSPECTIVE must be 0 or 1");
  }
  return value === "1" ? 1 : 0;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return await response.json() as T;
}

function liveEvidenceReady(health: HealthResponse, state: StateResponse, perspective: Side): boolean {
  const livePerspectives = Array.isArray(health.livePerspectives) ? health.livePerspectives : [];
  const session = health.liveSessions?.[String(perspective)];
  return livePerspectives.includes(perspective)
    && typeof session === "string" && session.length > 0
    && state.perspective === perspective
    && typeof state.sequence === "number" && Number.isSafeInteger(state.sequence) && state.sequence >= 1;
}

const baseUrl = (process.env.TRACKER_LIVE_ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const perspective = perspectiveEnv();
const timeoutMs = integerEnv("TRACKER_LIVE_ACCEPTANCE_TIMEOUT_MS", 60_000, 1_000);
const intervalMs = integerEnv("TRACKER_LIVE_ACCEPTANCE_INTERVAL_MS", 1_000, 250);
const outputPath = resolve(process.env.TRACKER_LIVE_ACCEPTANCE_OUT ?? `records/live/${Date.now()}-p${perspective}.json`);
const startedAt = Date.now();
let lastHealth: HealthResponse = {};
let lastState: StateResponse = {};
let lastError: string | undefined;

while (Date.now() - startedAt <= timeoutMs) {
  try {
    lastHealth = await getJson<HealthResponse>(`${baseUrl}/api/health`);
    lastState = await getJson<StateResponse>(`${baseUrl}/api/state?perspective=${perspective}`);
    lastError = undefined;
    if (liveEvidenceReady(lastHealth, lastState, perspective)) break;
  } catch (error) {
    lastError = String(error);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
}

const ok = liveEvidenceReady(lastHealth, lastState, perspective);
const evidence: LiveEvidence & { lastError?: string } = {
  ok,
  observedAt: new Date().toISOString(),
  baseUrl,
  perspective,
  elapsedMs: Date.now() - startedAt,
  health: lastHealth,
  state: lastState,
  ...(lastError ? { lastError } : {}),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...evidence, evidencePath: outputPath }, null, 2));
if (!ok) process.exitCode = 1;
