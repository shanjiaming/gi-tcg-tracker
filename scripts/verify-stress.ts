import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

type JsonRecord = Record<string, any>;

const node = process.execPath;
const stripTypes = ["--experimental-strip-types"];
const root = resolve(".");
const seeds = (process.env.TRACKER_STRESS_SEEDS ?? "20260721,20260722")
  .split(",").map((value) => value.trim()).filter(Boolean).map(Number);
if (seeds.length === 0 || seeds.some((seed) => !Number.isSafeInteger(seed))) {
  throw new Error("TRACKER_STRESS_SEEDS must contain at least one integer seed");
}

const policyPairs = (process.env.TRACKER_STRESS_POLICY_PAIRS ?? "random:random;cards:skills;skills:cards;tuning:cards;switch:skills;random:skills")
  .split(";").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const [mode0, mode1] = pair.split(":");
    if (!mode0 || !mode1) throw new Error(`invalid policy pair: ${pair}`);
    return { mode0, mode1 };
  });
if (policyPairs.length === 0) throw new Error("TRACKER_STRESS_POLICY_PAIRS must not be empty");

function run(label: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(node, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

function runJson(label: string, args: string[], env: NodeJS.ProcessEnv = process.env): JsonRecord {
  const output = run(label, args, env).trim();
  try {
    return JSON.parse(output) as JsonRecord;
  } catch {
    throw new Error(`${label} did not return JSON\n${output}`);
  }
}

const tempRoot = await mkdtemp(join(tmpdir(), "gi-tcg-tracker-stress-"));
const audits: JsonRecord[] = [];
const mutationCoverage = new Map<string, number>();
const cardTransitionCoverage = { played: 0, discarded: 0, tuned: 0, transferred: 0 };
let determinism: JsonRecord | undefined;
let completed = false;
try {
  for (const seed of seeds) {
    for (const policy of policyPairs) {
      const traceDir = join(tempRoot, `${seed}-${policy.mode0}-${policy.mode1}`);
      const env = {
        ...process.env,
        TRACKER_SIMULATOR_GAMES: "1",
        TRACKER_SIMULATOR_SEED: String(seed),
        TRACKER_SIMULATOR_MODE0: policy.mode0,
        TRACKER_SIMULATOR_MODE1: policy.mode1,
        TRACKER_TRACE_DIR: traceDir,
      };
      run(`generate seed=${seed} policy=${policy.mode0}:${policy.mode1}`, [
        ...stripTypes, "scripts/generate-simulator-trace.ts",
      ], env);
      if (!determinism && process.env.TRACKER_STRESS_SKIP_DETERMINISM !== "1") {
        const repeatDir = join(tempRoot, "determinism-repeat");
        const repeatEnv = { ...env, TRACKER_TRACE_DIR: repeatDir };
        run(`determinism repeat seed=${seed} policy=${policy.mode0}:${policy.mode1}`, [
          ...stripTypes, "scripts/generate-simulator-trace.ts",
        ], repeatEnv);
        const hashes: Record<string, string> = {};
        for (const perspective of [0, 1] as const) {
          const first = await readFile(join(traceDir, `game-${seed}-p${perspective}.jsonl`));
          const second = await readFile(join(repeatDir, `game-${seed}-p${perspective}.jsonl`));
          const firstHash = createHash("sha256").update(first).digest("hex");
          const secondHash = createHash("sha256").update(second).digest("hex");
          if (firstHash !== secondHash) {
            throw new Error(`non-deterministic trace for seed=${seed} policy=${policy.mode0}:${policy.mode1} perspective=${perspective}`);
          }
          hashes[`p${perspective}`] = firstHash;
        }
        determinism = { seed, mode0: policy.mode0, mode1: policy.mode1, sha256: hashes };
      }
      for (const perspective of [0, 1] as const) {
        const trace = join(traceDir, `game-${seed}-p${perspective}.jsonl`);
        const report = runJson(`audit ${trace}`, [...stripTypes, "scripts/audit-trace.ts", trace], env);
        if (report.warnings !== 0 || report.maskedStateLeaks !== 0 || report.maskedSnapshotLeaks !== 0 || report.errors !== 0
          || (report.lastPhase !== 5 && report.lastPhase !== "gameEnd")) {
          throw new Error(`stress invariant failed for ${trace}\n${JSON.stringify(report, null, 2)}`);
        }
        for (const [name, count] of Object.entries(report.mutationCounts ?? {})) {
          mutationCoverage.set(name, (mutationCoverage.get(name) ?? 0) + Number(count));
        }
        for (const kind of Object.keys(cardTransitionCoverage) as Array<keyof typeof cardTransitionCoverage>) {
          cardTransitionCoverage[kind] += Number(report.verifiedCardEvents?.[kind] ?? 0);
        }
        audits.push({ seed, perspective, mode0: policy.mode0, mode1: policy.mode1,
          notifications: report.notifications, transitions: report.verifiedExposedCardTransitions });
      }
    }
  }
  completed = true;
} finally {
  if (completed || process.env.TRACKER_STRESS_KEEP_FAILURES !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`stress traces retained at ${tempRoot}`);
  }
}

const totalNotifications = audits.reduce((sum, report) => sum + Number(report.notifications), 0);
const totalTransitions = audits.reduce((sum, report) => sum + Number(report.transitions), 0);
console.log(JSON.stringify({
  ok: true,
  seeds,
  policyPairs,
  games: seeds.length * policyPairs.length,
  traces: audits.length,
  notifications: totalNotifications,
  transitions: totalTransitions,
  determinism: determinism ?? null,
  cardTransitionCoverage,
  mutationCoverage: Object.fromEntries([...mutationCoverage].sort()),
  audits,
}, null, 2));
