import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

type AnyRecord = Record<string, any>;

type Scenario = {
  label: string;
  deck: string;
  targets: number[];
  required: number[];
  seed: number;
};

const root = resolve(".");
const traceRoot = resolve(process.env.TRACKER_REMAINING_TRACE_DIR ?? "records/coverage-traces/generated-remaining-v1");
const outputPath = resolve(process.env.TRACKER_REMAINING_OUTPUT ?? "records/coverage/generated-remaining-exploration.json");

const scenarios: Scenario[] = [
  {
    label: "countdown-dispose-chain",
    deck: "harness/decks/mechanism-a.json",
    // 332046 discards the highest-cost hand cards.  The selected seed places
    // 332032 in a hand where the real engine can dispose it, exposing the
    // 3 -> 2 -> 1 -> show-begins pile-top chain.
    targets: [332046],
    required: [332046, 332032, 332033, 332034, 332035],
    seed: 20260022,
  },
  {
    label: "lepinepauline-mega-plan",
    deck: "harness/decks/generated-only-a.json",
    // 322033 selects 302230; the latter randomly transforms into one of the
    // three graph-investment plans.  This seed reaches the mega plan 302224.
    targets: [322033, 302230, 302224],
    required: [322033, 302230, 302224],
    seed: 20260041,
  },
  {
    label: "tower-of-ipsissimus-adventure",
    deck: "harness/decks/generated-adventure.json",
    // The tower creates Wooden Toy Sword at adventure 5 and Reforged Holy
    // Blade at adventure 12.  The deck deliberately keeps one tower copy so
    // another adventure spot cannot replace it before the second threshold.
    targets: [321033, 321031, 322032, 332056, 312040, 312043, 301038, 301039],
    required: [321033, 301038, 301039],
    seed: 20260123,
  },
];

function run(label: string, script: string, environment: Record<string, string>, args: string[] = []): string {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-16000));
  }
  return result.stdout ?? "";
}

function parseJson(label: string, output: string): AnyRecord {
  try {
    return JSON.parse(output.trim()) as AnyRecord;
  } catch {
    throw new Error(`${label} did not return JSON\n${output.slice(-16000)}`);
  }
}

function containsDefinition(trace: string, id: number): boolean {
  return trace.includes(`"definitionId":${id}`);
}

const runs: AnyRecord[] = [];
await mkdir(traceRoot, { recursive: true });

for (const scenario of scenarios) {
  const deckPath = resolve(root, scenario.deck);
  const traceDir = resolve(traceRoot, scenario.label);
  const traces = [0, 1].map((who) => resolve(traceDir, `game-${scenario.seed}-p${who}.jsonl`));
  const environment = {
    GITCG_UPSTREAM_ROOT: process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation",
    TRACKER_SIMULATOR_DECK0: deckPath,
    TRACKER_SIMULATOR_DECK1: deckPath,
    TRACKER_SIMULATOR_TARGET_CARDS: scenario.targets.join(","),
    TRACKER_SIMULATOR_MODE0: process.env.TRACKER_REMAINING_MODE0 ?? "cards",
    TRACKER_SIMULATOR_MODE1: process.env.TRACKER_REMAINING_MODE1 ?? "cards",
    TRACKER_SIMULATOR_SEED: String(scenario.seed),
    TRACKER_SIMULATOR_GAMES: "1",
    TRACKER_TRACE_DIR: traceDir,
  };

  try {
    run(`simulate ${scenario.label}`, "scripts/generate-simulator-trace.ts", environment);
    const audits = traces.map((trace, perspective) => parseJson(
      `audit ${scenario.label} p${perspective}`,
      run(`audit ${scenario.label} p${perspective}`, "scripts/audit-trace.ts", {
        TRACKER_DECK0: deckPath,
        TRACKER_DECK1: deckPath,
      }, [trace]),
    ));
    const texts = await Promise.all(traces.map((trace) => readFile(trace, "utf8")));
    const observed = Object.fromEntries(scenario.required.map((id) => [
      String(id), texts.some((text) => containsDefinition(text, id)),
    ]));
    const failedAudit = audits.some((audit) => audit.ok !== true
      || Number(audit.errors) !== 0
      || Number(audit.warnings) !== 0
      || Number(audit.maskedStateLeaks) !== 0
      || Number(audit.maskedSnapshotLeaks) !== 0
      || (audit.lastPhase !== 5 && audit.lastPhase !== "gameEnd"));
    const allObserved = Object.values(observed).every(Boolean);
    if (failedAudit || !allObserved) {
      throw new Error(`coverage invariant failed: ${JSON.stringify({ observed, audits })}`);
    }
    runs.push({
      label: scenario.label,
      deck: scenario.deck,
      targets: scenario.targets,
      required: scenario.required,
      seed: scenario.seed,
      traces: traces.map((trace) => trace.replace(`${root}/`, "")),
      observed,
      audits,
      ok: true,
    });
  } catch (error) {
    runs.push({
      label: scenario.label,
      deck: scenario.deck,
      targets: scenario.targets,
      required: scenario.required,
      seed: scenario.seed,
      ok: false,
      error: String(error instanceof Error ? error.message : error),
    });
    break;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  traceRoot: traceRoot.replace(`${root}/`, ""),
  scenarios: scenarios.length,
  runs,
  ok: runs.length === scenarios.length && runs.every((run) => run.ok === true),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath.replace(`${root}/`, ""),
  runs: runs.length,
  scenarios: scenarios.length,
  ok: report.ok,
}, null, 2));
if (!report.ok) process.exitCode = 1;
