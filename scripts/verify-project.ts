import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const node = process.execPath;
const stripTypes = ["--experimental-strip-types"];
const seedTokens = (process.env.TRACKER_VERIFY_SEEDS ?? "20260715,20260716,20260717,20260718,20260719,20260720")
  .split(",").map((value) => value.trim()).filter(Boolean);
const seeds = seedTokens.map((value) => Number(value));
if (seeds.length === 0 || seeds.some((value) => !Number.isSafeInteger(value))) {
  throw new Error("TRACKER_VERIFY_SEEDS must contain at least one comma-separated integer seed");
}
const perspectives = [0, 1] as const;

function run(label: string, args: string[]): string {
  const result = spawnSync(node, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

function runJson(label: string, args: string[]): Record<string, any> {
  const output = run(label, args).trim();
  try {
    return JSON.parse(output) as Record<string, any>;
  } catch {
    throw new Error(`${label} did not return JSON\n${output}`);
  }
}

run("unit tests", [...stripTypes, "--test", "test/live.test.ts", "test/tracker.test.ts", "test/userscript.test.ts"]);
run("syntax check", [...stripTypes, "scripts/check-types.ts"]);
runJson("project boundaries", [...stripTypes, "scripts/check-boundaries.ts"]);

const localTsc = resolve("node_modules/typescript/bin/tsc");
const upstreamTsc = resolve("../genius-invokation/node_modules/typescript/bin/tsc");
const tsc = process.env.TRACKER_TYPESCRIPT_BIN
  ? resolve(process.env.TRACKER_TYPESCRIPT_BIN)
  : existsSync(localTsc) ? localTsc : upstreamTsc;
if (!existsSync(tsc)) throw new Error("typecheck unavailable: install project devDependencies or set TRACKER_TYPESCRIPT_BIN");
const typecheckArgs = [tsc, "--noEmit"];
if (!existsSync(localTsc) && existsSync(resolve("../genius-invokation/node_modules/@types/node"))) {
  typecheckArgs.push("--typeRoots", "../genius-invokation/node_modules/@types");
}
run("strict typecheck", typecheckArgs);

const audits: Record<string, any>[] = [];
for (const seed of seeds) {
  for (const perspective of perspectives) {
    const trace = `records/simulator/game-${seed}-p${perspective}.jsonl`;
    const report = runJson(`audit ${trace}`, [...stripTypes, "scripts/audit-trace.ts", trace]);
    if (report.warnings !== 0 || report.maskedStateLeaks !== 0 || report.maskedSnapshotLeaks !== 0 || report.errors !== 0
      || (report.lastPhase !== 5 && report.lastPhase !== "gameEnd")) {
      throw new Error(`audit invariant failed for ${trace}\n${JSON.stringify(report, null, 2)}`);
    }
    audits.push({ seed, perspective, notifications: report.notifications, transitions: report.verifiedExposedCardTransitions });
  }
}

console.log(JSON.stringify({
  ok: true,
  unitTests: "passed",
  syntax: "passed",
  boundaries: "passed",
  typecheck: "passed",
  traces: audits.length,
  notifications: audits.reduce((sum, report) => sum + report.notifications, 0),
  transitions: audits.reduce((sum, report) => sum + report.transitions, 0),
  audits,
}, null, 2));
