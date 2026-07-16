import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

type AnyRecord = Record<string, any>;

const root = resolve(".");
const deckRoot = resolve(process.env.TRACKER_GENERATED_COVERAGE_DECK_DIR
  ?? "records/coverage-decks/generated-character-v3");
const coveragePath = resolve(process.env.TRACKER_GENERATED_COVERAGE_INPUT
  ?? "records/coverage/card-coverage-aggregate-20260820.json");
const traceRoot = resolve(process.env.TRACKER_GENERATED_COVERAGE_TRACE_DIR
  ?? "records/coverage-traces/generated-character-v3-expanded");
const outputPath = resolve(process.env.TRACKER_GENERATED_COVERAGE_OUTPUT
  ?? "records/coverage/generated-character-exploration.json");
const maxDecks = Math.max(1, Number(process.env.TRACKER_GENERATED_COVERAGE_MAX_DECKS ?? 999));
const seedBase = Number(process.env.TRACKER_GENERATED_COVERAGE_SEED ?? 20260901);
const mode0 = process.env.TRACKER_GENERATED_COVERAGE_MODE0 ?? "cards";
const mode1 = process.env.TRACKER_GENERATED_COVERAGE_MODE1 ?? "cards";
const expectations = new Set((process.env.TRACKER_GENERATED_COVERAGE_EXPECTATIONS
  ?? "character-deck-obtainable").split(",").map((value) => value.trim()).filter(Boolean));
const requestedDecks = process.env.TRACKER_GENERATED_COVERAGE_DECKS
  ?.split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger);
const forcedTargets = process.env.TRACKER_GENERATED_COVERAGE_TARGET_CARDS
  ?.split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger);

function run(label: string, args: string[], environment: Record<string, string>): string {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-12000));
  }
  return result.stdout ?? "";
}

function json(label: string, output: string): AnyRecord {
  try {
    return JSON.parse(output.trim()) as AnyRecord;
  } catch {
    throw new Error(`${label} did not return JSON\n${output.slice(-12000)}`);
  }
}

const coverage = JSON.parse(await readFile(coveragePath, "utf8")) as AnyRecord;
const unobserved = new Set<number>((Array.isArray(coverage.cards) ? coverage.cards : [])
  .filter((card: AnyRecord) => !card.visibleInTrace && expectations.has(String(card.expectation)))
  .map((card: AnyRecord) => Number(card.id))
  .filter((id: number) => Number.isSafeInteger(id)));

const entries = (await readdir(deckRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /^generated_character-\d{3}\.json$/.test(entry.name))
  .map((entry) => ({
    name: entry.name,
    index: Number(entry.name.match(/(\d{3})/)?.[1]),
  }))
  .filter((entry) => Number.isSafeInteger(entry.index))
  .sort((a, b) => a.index - b.index);
const requested = requestedDecks?.length ? new Set(requestedDecks) : undefined;
const selected = entries.filter((entry) => !requested || requested.has(entry.index));
const runs: AnyRecord[] = [];

await mkdir(traceRoot, { recursive: true });
for (const entry of selected) {
  if (runs.length >= maxDecks) break;
  const deckPath = resolve(deckRoot, entry.name);
  const deck = JSON.parse(await readFile(deckPath, "utf8")) as AnyRecord;
  const targets = forcedTargets?.length
    ? forcedTargets.filter((id) => (Array.isArray(deck.targets) ? deck.targets : []).map(Number).includes(id))
    : (Array.isArray(deck.targets) ? deck.targets : []).map(Number).filter((id: number) => unobserved.has(id));
  if (!targets.length) continue;

  const seed = seedBase + entry.index;
  const traceDir = resolve(traceRoot, `deck-${String(entry.index).padStart(3, "0")}-${seed}`);
  const p0Trace = resolve(traceDir, `game-${seed}-p0.jsonl`);
  const p1Trace = resolve(traceDir, `game-${seed}-p1.jsonl`);
  const baseEnv = {
    GITCG_UPSTREAM_ROOT: process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation",
    TRACKER_SIMULATOR_DECK0: deckPath,
    TRACKER_SIMULATOR_DECK1: deckPath,
    TRACKER_SIMULATOR_TARGET_CARDS: [...new Set(targets)].join(","),
    TRACKER_SIMULATOR_MODE0: mode0,
    TRACKER_SIMULATOR_MODE1: mode1,
    TRACKER_SIMULATOR_SEED: String(seed),
    TRACKER_SIMULATOR_GAMES: "1",
    TRACKER_TRACE_DIR: traceDir,
  };
  try {
    run(`simulate deck ${entry.index}`, ["scripts/generate-simulator-trace.ts"], baseEnv);
    const audits = [p0Trace, p1Trace].map((trace, perspective) => json(
      `audit deck ${entry.index} p${perspective}`,
      run(`audit deck ${entry.index} p${perspective}`, ["scripts/audit-trace.ts", trace], {
        TRACKER_DECK0: deckPath,
        TRACKER_DECK1: deckPath,
      }),
    ));
    const failed = audits.filter((audit) => audit.ok !== true
      || Number(audit.warnings) !== 0
      || Number(audit.errors) !== 0
      || Number(audit.maskedStateLeaks) !== 0
      || Number(audit.maskedSnapshotLeaks) !== 0
      || (audit.lastPhase !== 5 && audit.lastPhase !== "gameEnd"));
    if (failed.length) throw new Error(`audit invariant failed: ${JSON.stringify(audits)}`);
    runs.push({
      deckIndex: entry.index,
      deck: deckPath.replace(`${root}/`, ""),
      sourceFile: deck.sourceFile,
      characters: deck.characters,
      targetCards: [...new Set(targets)],
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
    runs.push({
      deckIndex: entry.index,
      deck: deckPath.replace(`${root}/`, ""),
      sourceFile: deck.sourceFile,
      targetCards: [...new Set(targets)],
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    });
    break;
  }
}

const coveredTargets = new Set(runs.flatMap((run) => run.targetCards ?? []));
const report = {
  generatedAt: new Date().toISOString(),
  coverageInput: coveragePath.replace(`${root}/`, ""),
  deckRoot: deckRoot.replace(`${root}/`, ""),
  traceRoot: traceRoot.replace(`${root}/`, ""),
  mode0,
  mode1,
  expectations: [...expectations],
  selectedDecks: runs.length,
  candidateDecks: selected.length,
  unobservedTargetCards: unobserved.size,
  targetedCards: [...coveredTargets].sort((a, b) => a - b),
  runs,
  ok: runs.length > 0 && runs.every((run) => run.ok === true),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath.replace(`${root}/`, ""),
  selectedDecks: runs.length,
  candidateDecks: selected.length,
  unobservedTargetCards: unobserved.size,
  targetedCards: coveredTargets.size,
  notifications: runs.reduce((sum, run) => sum + Number(run.notifications ?? 0), 0),
  ok: report.ok,
}, null, 2));
if (!report.ok) process.exitCode = 1;
