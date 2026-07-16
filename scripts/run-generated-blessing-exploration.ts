import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

type AnyRecord = Record<string, any>;

type Scenario = {
  label: string;
  characters: number[];
  parent: number;
  children: [number, number];
};

const root = resolve(".");
const baseDeckPath = resolve(process.env.TRACKER_BLESSING_BASE_DECK ?? "harness/decks/mechanism-a.json");
const deckRoot = resolve(process.env.TRACKER_BLESSING_DECK_DIR ?? "records/coverage-decks/generated-blessing-v1");
const traceRoot = resolve(process.env.TRACKER_BLESSING_TRACE_DIR ?? "records/coverage-traces/generated-blessing-v1");
const outputPath = resolve(process.env.TRACKER_BLESSING_OUTPUT ?? "records/coverage/generated-blessing-exploration.json");
const seed = Number(process.env.TRACKER_BLESSING_SEED ?? 20260014);

const scenarios: Scenario[] = [
  { label: "vaporize", characters: [1208, 1201, 1304], parent: 331005, children: [303051, 303052] },
  { label: "bloom", characters: [1208, 1201, 1701], parent: 331006, children: [303061, 303062] },
  { label: "lava", characters: [1304, 1301, 1604], parent: 331007, children: [303071, 303072] },
  { label: "rimegrass", characters: [1102, 1106, 1701], parent: 331008, children: [303081, 303082] },
  { label: "stormgale", characters: [1405, 1410, 1502], parent: 331009, children: [303091, 303092] },
  { label: "aquabreeze", characters: [1208, 1201, 1502], parent: 331010, children: [303101, 303102] },
  { label: "thunderbloom", characters: [1405, 1410, 1701], parent: 331011, children: [303111, 3003112] },
  { label: "superconduct", characters: [1102, 1405, 1401], parent: 331004, children: [303041, 303042] },
];

function run(
  label: string,
  script: string,
  environment: Record<string, string>,
  scriptArgs: string[] = [],
): string {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script, ...scriptArgs], {
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

const baseDeck = JSON.parse(await readFile(baseDeckPath, "utf8")) as AnyRecord;
const runs: AnyRecord[] = [];
await mkdir(deckRoot, { recursive: true });
await mkdir(traceRoot, { recursive: true });

for (const scenario of scenarios) {
  const deckPath = resolve(deckRoot, `${scenario.label}.json`);
  const deck = {
    ...baseDeck,
    characters: scenario.characters,
    // mechanism-a already has two copies of 331004 in the target slots.
    // Replacing only those slots keeps the rest of the deck identical while
    // keeping generated-only blessing cards out of ordinary deck fixtures.
    cards: (Array.isArray(baseDeck.cards) ? baseDeck.cards : []).map((id) => Number(id) === 331004 ? scenario.parent : id),
    sourceFile: `generated-blessing-v1/${scenario.label}`,
    targets: [scenario.parent, ...scenario.children],
  };
  await writeFile(deckPath, `${JSON.stringify(deck, null, 2)}\n`, "utf8");

  for (const child of scenario.children) {
    const label = `${scenario.label}-${child}`;
    const runSeed = seed;
    const traceDir = resolve(traceRoot, `${scenario.label}-${child}-${runSeed}`);
    const p0Trace = resolve(traceDir, `game-${runSeed}-p0.jsonl`);
    const p1Trace = resolve(traceDir, `game-${runSeed}-p1.jsonl`);
    const targets = [scenario.parent, child].join(",");
    const baseEnv = {
      GITCG_UPSTREAM_ROOT: process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation",
      TRACKER_SIMULATOR_DECK0: deckPath,
      TRACKER_SIMULATOR_DECK1: deckPath,
      TRACKER_SIMULATOR_TARGET_CARDS: targets,
      TRACKER_SIMULATOR_MODE0: process.env.TRACKER_BLESSING_MODE0 ?? "skills",
      TRACKER_SIMULATOR_MODE1: process.env.TRACKER_BLESSING_MODE1 ?? "skills",
      TRACKER_SIMULATOR_PREFERRED_SKILL_IDS: scenario.characters.map((id) => id * 10 + 2).join(","),
      TRACKER_SIMULATOR_SEED: String(runSeed),
      TRACKER_SIMULATOR_GAMES: "1",
      TRACKER_TRACE_DIR: traceDir,
    };
    try {
      run(`simulate ${label}`, "scripts/generate-simulator-trace.ts", baseEnv);
      const audits = [p0Trace, p1Trace].map((trace, perspective) => parseJson(
        `audit ${label} p${perspective}`,
        run(`audit ${label} p${perspective}`, "scripts/audit-trace.ts", {
          TRACKER_DECK0: deckPath,
          TRACKER_DECK1: deckPath,
        }, [trace]),
      ));
      const traceText = await Promise.all([p0Trace, p1Trace].map((path) => readFile(path, "utf8")));
      const observed = {
        parent: traceText.some((text) => containsDefinition(text, scenario.parent)),
        child: traceText.some((text) => containsDefinition(text, child)),
      };
      const failedAudit = audits.some((audit) => audit.ok !== true
        || Number(audit.errors) !== 0
        || Number(audit.warnings) !== 0
        || Number(audit.maskedStateLeaks) !== 0
        || Number(audit.maskedSnapshotLeaks) !== 0
        || (audit.lastPhase !== 5 && audit.lastPhase !== "gameEnd"));
      if (failedAudit || !observed.parent || !observed.child) {
        throw new Error(`coverage invariant failed: ${JSON.stringify({ observed, audits })}`);
      }
      runs.push({
        scenario: scenario.label,
        characters: scenario.characters,
        parent: scenario.parent,
        child,
        seed: runSeed,
        deck: deckPath.replace(`${root}/`, ""),
        traces: [p0Trace, p1Trace].map((path) => path.replace(`${root}/`, "")),
        notifications: audits.reduce((sum, audit) => sum + Number(audit.notifications ?? 0), 0),
        observed,
        audits,
        ok: true,
      });
    } catch (error) {
      runs.push({
        scenario: scenario.label,
        characters: scenario.characters,
        parent: scenario.parent,
        child,
        seed: runSeed,
        deck: deckPath.replace(`${root}/`, ""),
        ok: false,
        error: String(error instanceof Error ? error.message : error),
      });
      break;
    }
  }
  if (runs.some((run) => run.scenario === scenario.label && run.ok !== true)) break;
}

const report = {
  generatedAt: new Date().toISOString(),
  baseDeck: baseDeckPath.replace(`${root}/`, ""),
  deckRoot: deckRoot.replace(`${root}/`, ""),
  traceRoot: traceRoot.replace(`${root}/`, ""),
  seed,
  scenarios: scenarios.length,
  runs,
  ok: runs.length === scenarios.length * 2 && runs.every((run) => run.ok === true),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath.replace(`${root}/`, ""),
  runs: runs.length,
  scenarios: scenarios.length,
  notifications: runs.reduce((sum, run) => sum + Number(run.notifications ?? 0), 0),
  ok: report.ok,
}, null, 2));
if (!report.ok) process.exitCode = 1;
