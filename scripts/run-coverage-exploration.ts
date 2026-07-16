import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

type AnyRecord = Record<string, any>;

const root = resolve(".");
const deckRoot = resolve(process.env.TRACKER_COVERAGE_DECK_DIR ?? "records/coverage-decks");
const coveragePath = resolve(process.env.TRACKER_CARD_COVERAGE_INPUT ?? "records/coverage/card-coverage.json");
const traceRoot = resolve(process.env.TRACKER_COVERAGE_TRACE_DIR ?? "records/coverage-traces/automated");
const outputPath = resolve(process.env.TRACKER_COVERAGE_EXPLORE_OUTPUT ?? "records/coverage/automated-exploration.json");
const requestedSignals = (process.env.TRACKER_COVERAGE_EXPLORE_SIGNALS
  ?? "hand_exchange,generate_pile,return_to_deck,steal_transfer,discard_or_tune,selection,dice,conditional")
  .split(",").map((value) => value.trim()).filter(Boolean);
const maxGroups = Math.max(1, Number(process.env.TRACKER_COVERAGE_EXPLORE_MAX_GROUPS ?? 2));
const signals = requestedSignals.slice(0, maxGroups);
const maxDecksPerSignal = Math.max(1, Number(process.env.TRACKER_COVERAGE_EXPLORE_MAX_DECKS ?? 1));
const seedBase = Number(process.env.TRACKER_COVERAGE_EXPLORE_SEED ?? 20260731);
const mode0 = process.env.TRACKER_COVERAGE_EXPLORE_MODE0 ?? "cards";
const mode1 = process.env.TRACKER_COVERAGE_EXPLORE_MODE1 ?? "random";

const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as AnyRecord;
const targetIdsBySignal = new Map<string, Set<number>>();
const unsignaledDirectIds = new Set<number>();
for (const rawCard of Array.isArray(coverage.cards) ? coverage.cards : []) {
  const card = rawCard && typeof rawCard === "object" && !Array.isArray(rawCard) ? rawCard as AnyRecord : undefined;
  if (!card || card.expectation !== "directly-obtainable") continue;
  const id = Number(card.id);
  const source = card.source && typeof card.source === "object" && !Array.isArray(card.source) ? card.source as AnyRecord : undefined;
  if (!Number.isSafeInteger(id)) continue;
  if (!Array.isArray(source?.sourceSignals) || source.sourceSignals.length === 0) unsignaledDirectIds.add(id);
  if (!Array.isArray(source?.sourceSignals)) continue;
  for (const signal of source.sourceSignals) {
    if (typeof signal !== "string") continue;
    const ids = targetIdsBySignal.get(signal) ?? new Set<number>();
    ids.add(id);
    targetIdsBySignal.set(signal, ids);
  }
}
targetIdsBySignal.set("direct", unsignaledDirectIds);

function run(label: string, args: string[], environment: Record<string, string>): string {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-6000);
    throw new Error(`${label} failed\n${output}`);
  }
  return result.stdout ?? "";
}

function parseJson(label: string, output: string): AnyRecord {
  try {
    return JSON.parse(output.trim()) as AnyRecord;
  } catch {
    throw new Error(`${label} did not return JSON\n${output.slice(-6000)}`);
  }
}

const runs: AnyRecord[] = [];
await mkdir(traceRoot, { recursive: true });
for (const [signalIndex, signal] of signals.entries()) {
  const deckFiles = (await readdir(deckRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile()
      && entry.name.startsWith(`${signal}-`)
      && /^\d{3}\.json$/.test(entry.name.slice(signal.length + 1)))
    .map((entry) => entry.name)
    .sort()
    .slice(0, maxDecksPerSignal);
  if (!deckFiles.length) throw new Error(`no generated deck found for coverage signal ${signal}`);
  for (const [deckIndex, deckFile] of deckFiles.entries()) {
    const seed = seedBase + signalIndex * maxDecksPerSignal + deckIndex;
    const deckPath = resolve(deckRoot, deckFile);
    const traceDir = resolve(traceRoot, `${signal}-${seed}`);
    const p0Trace = resolve(traceDir, `game-${seed}-p0.jsonl`);
    const p1Trace = resolve(traceDir, `game-${seed}-p1.jsonl`);
    const deck = JSON.parse(await readFile(deckPath, "utf8")) as AnyRecord;
    const signalTargetIds = targetIdsBySignal.get(signal) ?? new Set<number>();
    const targetCards = [...new Set((Array.isArray(deck.cards) ? deck.cards : [])
      .map(Number)
      .filter((id): id is number => Number.isSafeInteger(id) && signalTargetIds.has(id)))];
    const environment = {
      GITCG_UPSTREAM_ROOT: process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation",
      TRACKER_SIMULATOR_DECK0: deckPath,
      TRACKER_SIMULATOR_DECK1: deckPath,
      TRACKER_SIMULATOR_TARGET_CARDS: targetCards.join(","),
      TRACKER_SIMULATOR_MODE0: mode0,
      TRACKER_SIMULATOR_MODE1: mode1,
      TRACKER_SIMULATOR_SEED: String(seed),
      TRACKER_SIMULATOR_GAMES: "1",
      TRACKER_TRACE_DIR: traceDir,
    };
    try {
      run(`simulate ${signal}-${deckIndex + 1}`, ["scripts/generate-simulator-trace.ts"], environment);
      const audits = [p0Trace, p1Trace].map((trace, perspective) => parseJson(
        `audit ${signal}-${deckIndex + 1} p${perspective}`,
        run(`audit ${signal}-${deckIndex + 1} p${perspective}`, ["scripts/audit-trace.ts", trace], {
          TRACKER_DECK0: deckPath,
          TRACKER_DECK1: deckPath,
        }),
      ));
      if (audits.some((audit) => audit.ok !== true || Number(audit.warnings) !== 0 || Number(audit.errors) !== 0)) {
        throw new Error(`audit invariants failed for ${signal}-${deckIndex + 1}: ${JSON.stringify(audits)}`);
      }
      runs.push({
        signal,
        deckIndex: deckIndex + 1,
        seed,
        deck: deckPath.replace(`${root}/`, ""),
        targetCards,
        traces: [p0Trace, p1Trace].map((path) => path.replace(`${root}/`, "")),
        notifications: audits.reduce((sum, audit) => sum + Number(audit.notifications ?? 0), 0),
        verifiedCardEvents: audits.reduce((sum, audit) => ({
          played: sum.played + Number(audit.verifiedCardEvents?.played ?? 0),
          discarded: sum.discarded + Number(audit.verifiedCardEvents?.discarded ?? 0),
          tuned: sum.tuned + Number(audit.verifiedCardEvents?.tuned ?? 0),
          transferred: sum.transferred + Number(audit.verifiedCardEvents?.transferred ?? 0),
        }), { played: 0, discarded: 0, tuned: 0, transferred: 0 }),
        audits,
        ok: true,
      });
    } catch (error) {
      runs.push({ signal, deckIndex: deckIndex + 1, seed, ok: false, error: String(error instanceof Error ? error.message : error) });
      break;
    }
  }
  if (runs.some((run) => run.signal === signal && run.ok !== true)) break;
}

const report = {
  generatedAt: new Date().toISOString(),
  requestedSignals,
  signals,
  maxGroups,
  maxDecksPerSignal,
  mode0,
  mode1,
  sequential: true,
  runs,
  ok: runs.length > 0 && runs.every((run) => run.ok === true)
    && signals.every((signal) => runs.some((run) => run.signal === signal)),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath.replace(`${root}/`, ""), ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
