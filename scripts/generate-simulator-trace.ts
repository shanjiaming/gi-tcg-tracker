import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Side = 0 | 1;
type AnyRecord = Record<string, any>;
type RandomSource = () => number;

const projectRoot = resolve(".");
const upstreamRoot = resolve(process.env.GITCG_UPSTREAM_ROOT ?? "../genius-invokation");
const outputRoot = resolve(process.env.TRACKER_TRACE_DIR ?? "records/simulator");
const games = Math.max(1, Number(process.env.TRACKER_SIMULATOR_GAMES ?? 2));
const seedBase = Number(process.env.TRACKER_SIMULATOR_SEED ?? 20260715);

const core = await import(pathToFileURL(join(upstreamRoot, "packages/core/dist/index.js")).href);
const utils = await import(pathToFileURL(join(upstreamRoot, "packages/utils/dist/index.js")).href);
const dataModule = await import(pathToFileURL(join(upstreamRoot, "packages/data/dist/index.js")).href);
const data = dataModule.default(core.CURRENT_VERSION);

const deckAPath = resolve(process.env.TRACKER_SIMULATOR_DECK0 ?? join(projectRoot, "harness/decks/standard-a.json"));
const deckBPath = resolve(process.env.TRACKER_SIMULATOR_DECK1 ?? join(projectRoot, "harness/decks/standard-b.json"));
const deckA = JSON.parse(await readFile(deckAPath, "utf8"));
const deckB = JSON.parse(await readFile(deckBPath, "utf8"));
const targetCardOrder = [...new Set((process.env.TRACKER_SIMULATOR_TARGET_CARDS ?? "")
  .split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger))];
const targetCards = new Set(targetCardOrder);
const preferredSkillIds = new Set((process.env.TRACKER_SIMULATOR_PREFERRED_SKILL_IDS ?? "")
  .split(",").map((value) => Number(value.trim())).filter(Number.isSafeInteger));
const modes: [string, string] = [
  process.env.TRACKER_SIMULATOR_MODE0 ?? "cards",
  process.env.TRACKER_SIMULATOR_MODE1 ?? "skills",
];
const supportedModes = new Set(["cards", "skills", "tuning", "switch", "random"]);
for (const mode of modes) {
  if (!supportedModes.has(mode)) throw new Error(`unsupported simulator policy mode: ${mode}`);
}
const liveIngestBase = process.env.TRACKER_SIMULATOR_INGEST_BASE?.replace(/\/+$/, "");
const liveIngestDelayMs = Math.max(0, Number(process.env.TRACKER_SIMULATOR_LIVE_DELAY_MS ?? 0));

async function postLiveJson(path: string, body: AnyRecord): Promise<AnyRecord> {
  if (!liveIngestBase) throw new Error("live ingest is not configured");
  const response = await fetch(`${liveIngestBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: AnyRecord = {};
  try {
    payload = JSON.parse(text) as AnyRecord;
  } catch {
    throw new Error(`live ingest returned non-JSON ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(`live ingest ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

// The pinned upstream helper intentionally uses Math.random() for initial deck shuffling,
// which is independent of Game's state randomSeed. Pre-shuffle here with the same small LCG
// family used by the engine, then ask the engine not to shuffle again. This keeps a stress
// trace reproducible without modifying the upstream checkout or globally monkey-patching Math.random.
const RANDOM_MODULUS = 2_147_483_647;
const RANDOM_MULTIPLIER = 48_271;

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  let state = ((Math.trunc(seed) % (RANDOM_MODULUS - 1)) + (RANDOM_MODULUS - 1)) % (RANDOM_MODULUS - 1) + 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (RANDOM_MULTIPLIER * state) % RANDOM_MODULUS;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function seededRandom(seed: number): RandomSource {
  let state = ((Math.trunc(seed) % (RANDOM_MODULUS - 1)) + (RANDOM_MODULUS - 1)) % (RANDOM_MODULUS - 1) + 1;
  return () => {
    state = (RANDOM_MULTIPLIER * state) % RANDOM_MODULUS;
    return state / RANDOM_MODULUS;
  };
}

function randomIndex(random: RandomSource, length: number): number {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

function oneof(request: AnyRecord): { name: string; value: AnyRecord } {
  const value = request.request;
  if (!value || typeof value.$case !== "string") throw new Error("simulator request has no oneof");
  return { name: value.$case, value: value.value ?? {} };
}

function choosePayment(option: AnyRecord, dice: number[]): number[] | undefined {
  const action = option?.action;
  if (action?.$case === "elementalTuning") {
    const candidate = dice.find((die) => die !== 8);
    return candidate === undefined ? undefined : [candidate];
  }
  const requirements = Array.isArray(option?.requiredCost) ? option.requiredCost : [];
  const cost = new Map<number, number>();
  for (const requirement of requirements) {
    const type = Number(requirement?.type);
    const count = Math.max(0, Number(requirement?.count ?? 0));
    if (Number.isSafeInteger(type) && count > 0) cost.set(type, count);
  }
  const selected = utils.chooseDiceValue(cost, dice, new Set(), new Set(), new Set());
  return utils.checkDice(cost, selected) ? selected : undefined;
}

function policyResponse(
  method: string,
  payload: AnyRecord,
  state: AnyRecord,
  who: Side,
  mode: string,
  actionCount: number,
  random: RandomSource,
  targets: Set<number>,
): AnyRecord {
  const randomMode = mode === "random";
  if (method === "chooseActive") {
    const candidates = Array.isArray(payload.candidateIds) ? payload.candidateIds : [];
    const index = randomMode ? randomIndex(random, candidates.length) : (who ? candidates.length - 1 : 0);
    return core.createRpcResponse(method, { activeCharacterId: candidates[index] });
  }
  if (method === "switchHands") {
    const hand = state?.player?.[who]?.handCard ?? [];
    const ids = hand.map((card: AnyRecord) => card.id).filter(Number.isSafeInteger);
    const removedHandIds = randomMode
      ? ids.filter(() => random() < 0.5)
      : ids.filter((_: number, index: number) => index % 2 === 0);
    return core.createRpcResponse(method, { removedHandIds });
  }
  if (method === "rerollDice") {
    const dice = state?.player?.[who]?.dice ?? [];
    if (randomMode) {
      return core.createRpcResponse(method, { diceToReroll: dice.filter(() => random() < 0.5) });
    }
    const counts = new Map<number, number>();
    const reroll: number[] = [];
    for (const die of dice) {
      const value = Number(die);
      const seen = counts.get(value) ?? 0;
      counts.set(value, seen + 1);
      if (seen > 0) reroll.push(value);
    }
    return core.createRpcResponse(method, { diceToReroll: reroll });
  }
  if (method === "selectCard") {
    const candidates = Array.isArray(payload.candidateDefinitionIds) ? payload.candidateDefinitionIds : [];
    const preferred = candidates.findIndex((id: number) => targets.has(Number(id)));
    const index = preferred >= 0
      ? preferred
      : randomMode ? randomIndex(random, candidates.length) : (who ? candidates.length - 1 : 0);
    return core.createRpcResponse(method, { selectedDefinitionId: candidates[index] });
  }
  if (method !== "action") throw new Error(`unsupported method ${method}`);
  const actions: AnyRecord[] = Array.isArray(payload.action) ? payload.action : [];
  if (process.env.TRACKER_SIMULATOR_DEBUG_ACTIONS === "1" && actionCount < 4) {
    console.error(JSON.stringify({ method, who, actions: actions.map((option) => option?.action) }));
  }
  const desired = mode === "cards" ? ["playCard", "useSkill", "switchActive", "elementalTuning"]
    : mode === "tuning" ? ["elementalTuning", "useSkill", "playCard", "switchActive"]
    : mode === "switch" ? ["switchActive", "useSkill", "playCard", "elementalTuning"]
    : ["useSkill", "playCard", "switchActive", "elementalTuning"];
  const dice = Array.isArray(state?.player?.[who]?.dice) ? state.player[who].dice.map(Number) : [];
  const candidates: Array<{ index: number; action: AnyRecord; payment: number[] }> = [];
  for (const [index, option] of actions.entries()) {
    if (Number(option?.validity) !== 0) continue;
    const action = option?.action;
    if (!action || typeof action.$case !== "string" || action.$case === "declareEnd") continue;
    const payment = choosePayment(option, dice);
    if (payment) candidates.push({ index, action, payment });
  }
  if (!randomMode) {
    const targetTuningEntityIds = new Set(
      (state?.player?.[who]?.handCard ?? [])
        .filter((card: AnyRecord) => targets.has(Number(card.definitionId)))
        .map((card: AnyRecord) => Number(card.id))
        .filter(Number.isSafeInteger),
    );
    candidates.sort((a, b) => {
      const actionValue = (candidate: { action: AnyRecord }) => candidate.action.value ?? candidate.action;
      const targetPriority = (candidate: { action: AnyRecord }) => {
        const targetDefinitionId = candidate.action.$case === "playCard"
          ? Number(actionValue(candidate).cardDefinitionId)
          : undefined;
        const tuningTarget = candidate.action.$case === "elementalTuning"
          && targetTuningEntityIds.has(Number(actionValue(candidate).removedCardId));
        if (targetDefinitionId !== undefined && targets.has(targetDefinitionId)) {
          return targetCardOrder.indexOf(targetDefinitionId);
        }
        if (tuningTarget) {
          const targetCard = (state?.player?.[who]?.handCard ?? [])
            .find((card: AnyRecord) => Number(card.id) === Number(actionValue(candidate).removedCardId));
          return targetCard ? targetCardOrder.indexOf(Number(targetCard.definitionId)) : targetCardOrder.length;
        }
        return targetCardOrder.length;
      };
      const skillPriority = (candidate: { action: AnyRecord }) => mode === "skills"
        && candidate.action.$case === "useSkill"
        ? -Number(actionValue(candidate).skillDefinitionId ?? 0) : 0;
      const preferredSkillPriority = (candidate: { action: AnyRecord }) => candidate.action.$case === "useSkill"
        && preferredSkillIds.has(Number(actionValue(candidate).skillDefinitionId)) ? -1 : 0;
      return targetPriority(a) - targetPriority(b)
        || desired.indexOf(a.action.$case) - desired.indexOf(b.action.$case)
        || preferredSkillPriority(a) - preferredSkillPriority(b)
        || skillPriority(a) - skillPriority(b)
        || a.index - b.index;
    });
  }
  const chosen = candidates.length === 0 ? undefined : candidates[randomMode ? randomIndex(random, candidates.length) : 0];
  if (chosen) {
    return core.createRpcResponse(method, {
      chosenActionIndex: chosen.index,
      usedDice: chosen.payment,
    });
  }
  const endIndex = actions.findIndex((option) => option?.action?.$case === "declareEnd");
  if (endIndex < 0) throw new Error(`no payable action at count=${actionCount}`);
  return core.createRpcResponse(method, { chosenActionIndex: endIndex, usedDice: [] });
}

function createTraceWriter(perspective: Side, gameSeed: number): { records: AnyRecord[]; append: (record: AnyRecord) => void } {
  const records: AnyRecord[] = [{ kind: "session", perspective, gameSeed, source: "pinned-upstream-game" }];
  return { records, append: (record) => records.push(record) };
}

for (let gameIndex = 0; gameIndex < games; gameIndex++) {
  const gameSeed = seedBase + gameIndex;
  const traces = [createTraceWriter(0, gameSeed), createTraceWriter(1, gameSeed)];
  const liveSessionIds: [string, string] = [`sim-${gameSeed}-p0`, `sim-${gameSeed}-p1`];
  const liveQueue: Array<{ who: Side; notification: AnyRecord }> = [];
  let liveFlushChain = Promise.resolve();
  const flushLiveQueue = async (): Promise<void> => {
    if (!liveIngestBase) return;
    const current = liveFlushChain.then(async () => {
      while (liveQueue.length > 0) {
        const item = liveQueue.shift()!;
        await postLiveJson("/api/ingest", {
          perspective: item.who,
          sessionId: liveSessionIds[item.who],
          notification: item.notification,
        });
        if (liveIngestDelayMs > 0) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, liveIngestDelayMs));
        }
      }
    });
    liveFlushChain = current.catch(() => undefined);
    await current;
  };
  const lastState: [AnyRecord, AnyRecord] = [{}, {}];
  const handIds: [number[], number[]] = [[], []];
  const actionCount: [number, number] = [0, 0];
  const policyRandom: [RandomSource, RandomSource] = [
    seededRandom(gameSeed + 3_000_007),
    seededRandom(gameSeed + 4_000_013),
  ];
  const initialState = core.Game.createInitialState({
    data,
    randomSeed: gameSeed,
    decks: [
      { ...deckA, cards: seededShuffle(deckA.cards, gameSeed + 1_000_003), noShuffle: true },
      { ...deckB, cards: seededShuffle(deckB.cards, gameSeed + 2_000_033), noShuffle: true },
    ],
  });
  const game = new core.Game(initialState);
  if (liveIngestBase) {
    for (const who of [0, 1] as const) {
      await postLiveJson("/api/session", {
        perspective: who,
        sessionId: liveSessionIds[who],
        replace: true,
        deck: who === 0 ? deckA : deckB,
        opponentDeck: who === 0 ? deckB : deckA,
      });
    }
  }
  for (const who of [0, 1] as const) {
    game.players[who].config = { alwaysOmni: true, allowTuningAnyDice: true };
    game.players[who].io.notify = (notification: AnyRecord) => {
      const state = notification.state as AnyRecord;
      lastState[who] = state;
      handIds[who] = (state.player?.[who]?.handCard ?? []).map((card: AnyRecord) => card.id);
      const sequence = traces[who].records.filter((record) => record.kind === "notification").length + 1;
      traces[who].append({
        kind: "notification",
        sequence,
        state,
        mutation: notification.mutation ?? [],
        terminal: state.phase === "gameEnd" || state.phase === 5,
      });
      if (liveIngestBase) {
        liveQueue.push({ who, notification });
      }
    };
    game.players[who].io.rpc = async (request: AnyRecord) => {
      await flushLiveQueue();
      const { name, value } = oneof(request);
      const response = policyResponse(name, value, lastState[who], who, modes[who], actionCount[who], policyRandom[who], targetCards);
      actionCount[who] += name === "action" ? 1 : 0;
      return response;
    };
  }
  game.onIoError = (error: Error) => {
    for (const trace of traces) trace.append({ kind: "error", message: String(error?.message ?? error) });
  };
  await game.start();
  await flushLiveQueue();
  await mkdir(outputRoot, { recursive: true });
  for (const [who, trace] of traces.entries()) {
    const path = join(outputRoot, `game-${gameSeed}-p${who}.jsonl`);
    await writeFile(path, trace.records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    console.log(JSON.stringify({ game: gameIndex + 1, games, gameSeed, perspective: who, path, frames: trace.records.length - 1, actions: actionCount[who] }));
  }
}
