import type { CharacterSnapshot, EntitySnapshot, TrackerFrame, PublicPlayerSnapshot, Side } from "./types.ts";

const MAX_ENTITY_COUNT = 256;
const MAX_ENTITY_DEPTH = 8;
const MAX_PLAYER_COUNT = 2;
const MAX_CHARACTER_COUNT = 16;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeEntity(value: unknown, depth = 0): EntitySnapshot | undefined {
  if (depth > MAX_ENTITY_DEPTH) return undefined;
  const source = record(value);
  if (!source) return undefined;
  const attachment = source.attachment;
  if (attachment !== undefined && (!Array.isArray(attachment) || attachment.length > MAX_ENTITY_COUNT)) return undefined;
  const children = attachment === undefined
    ? undefined
    : attachment.map((item) => normalizeEntity(item, depth + 1));
  if (children?.some((item) => item === undefined)) return undefined;
  return {
    ...(typeof source.id === "number" && Number.isSafeInteger(source.id) ? { id: source.id } : {}),
    ...(typeof source.definitionId === "number" && Number.isSafeInteger(source.definitionId) ? { definitionId: source.definitionId } : {}),
    ...(typeof source.name === "string" ? { name: source.name } : {}),
    ...(typeof source.type === "string" || (typeof source.type === "number" && Number.isFinite(source.type)) ? { type: source.type } : {}),
    ...(typeof source.variableName === "string" ? { variableName: source.variableName } : {}),
    ...(typeof source.variableValue === "number" && Number.isFinite(source.variableValue) ? { variableValue: source.variableValue } : {}),
    ...(children === undefined ? {} : { attachment: children as EntitySnapshot[] }),
  };
}

function arrayOfEntities(value: unknown): EntitySnapshot[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ENTITY_COUNT) return undefined;
  const entities = value.map((item) => normalizeEntity(item));
  return entities.some((item) => item === undefined) ? undefined : entities as EntitySnapshot[];
}

function normalizeCharacters(value: unknown): CharacterSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_CHARACTER_COUNT) return undefined;
  const characters: CharacterSnapshot[] = [];
  for (const item of value) {
    const source = record(item);
    if (!source) return undefined;
    const entity = source.entity === undefined ? undefined : arrayOfEntities(source.entity);
    if (source.entity !== undefined && !entity) return undefined;
    characters.push({
      ...(typeof source.id === "number" && Number.isSafeInteger(source.id) ? { id: source.id } : {}),
      ...(typeof source.definitionId === "number" && Number.isSafeInteger(source.definitionId) ? { definitionId: source.definitionId } : {}),
      ...(typeof source.name === "string" ? { name: source.name } : {}),
      ...(typeof source.defeated === "boolean" ? { defeated: source.defeated } : {}),
      ...(typeof source.health === "number" && Number.isFinite(source.health) ? { health: source.health } : {}),
      ...(typeof source.maxHealth === "number" && Number.isFinite(source.maxHealth) ? { maxHealth: source.maxHealth } : {}),
      ...(typeof source.energy === "number" && Number.isFinite(source.energy) ? { energy: source.energy } : {}),
      ...(typeof source.maxEnergy === "number" && Number.isFinite(source.maxEnergy) ? { maxEnergy: source.maxEnergy } : {}),
      ...(typeof source.aura === "string" || (typeof source.aura === "number" && Number.isFinite(source.aura)) ? { aura: source.aura } : {}),
      ...(entity === undefined ? {} : { entity }),
    });
  }
  return characters;
}

function copyPlayer(value: unknown): PublicPlayerSnapshot | undefined {
  const player = record(value);
  if (!player) return undefined;
  const result: PublicPlayerSnapshot = {};
  if (player.character !== undefined) {
    const characters = normalizeCharacters(player.character);
    if (!characters) return undefined;
    result.character = characters;
  }
  for (const field of ["combatStatus", "summon", "support", "pileCard", "handCard"] as const) {
    if (player[field] !== undefined) {
      const entities = arrayOfEntities(player[field]);
      if (!entities) return undefined;
      result[field] = entities;
    }
  }
  if (player.dice !== undefined) {
    if (!Array.isArray(player.dice) || player.dice.length > MAX_ENTITY_COUNT
      || !player.dice.every((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))) return undefined;
    result.dice = [...player.dice] as Array<string | number>;
  }
  if (player.activeCharacterId !== undefined) {
    if (typeof player.activeCharacterId !== "number" || !Number.isSafeInteger(player.activeCharacterId)) return undefined;
    result.activeCharacterId = player.activeCharacterId;
  }
  if (player.status !== undefined) {
    if (typeof player.status !== "string" && typeof player.status !== "number") return undefined;
    result.status = player.status;
  }
  for (const field of ["declaredEnd", "legendUsed"] as const) {
    if (typeof player[field] === "boolean") result[field] = player[field];
  }
  return result;
}

function normalizedPlayers(state: Record<string, unknown>): PublicPlayerSnapshot[] | undefined {
  if (state.player === undefined) return [];
  if (!Array.isArray(state.player) || state.player.length > MAX_PLAYER_COUNT) return undefined;
  const players = state.player.map(copyPlayer);
  return players.some((player) => player === undefined) ? undefined : players as PublicPlayerSnapshot[];
}

function invalidFrame(sequence: number, perspective: Side): TrackerFrame {
  return { sequence, perspective, state: { player: {} as never }, mutations: [] };
}

export function frameFromNotification(
  sequence: number,
  perspective: Side,
  state: unknown,
  mutations: unknown[] = [],
): TrackerFrame {
  const source = record(state);
  if (!source) return invalidFrame(sequence, perspective);
  const players = normalizedPlayers(source);
  if (!players) return invalidFrame(sequence, perspective);
  const currentTurn = source.currentTurn === 0 || source.currentTurn === 1 ? source.currentTurn : undefined;
  const winner = source.winner === 0 || source.winner === 1 ? source.winner : undefined;
  return {
    sequence,
    perspective,
    state: {
      ...(source.phase === undefined ? {} : { phase: source.phase as string | number }),
      ...(Number.isSafeInteger(source.roundNumber) ? { roundNumber: source.roundNumber as number } : {}),
      ...(currentTurn === undefined ? {} : { currentTurn }),
      ...(winner === undefined ? {} : { winner }),
      ...(source.player === undefined ? {} : { player: players }),
    },
    mutations: Array.isArray(mutations) ? [...mutations] : [],
  };
}

export function isValidNotificationState(state: unknown): boolean {
  const source = record(state);
  return source !== undefined && normalizedPlayers(source) !== undefined;
}

export function entityId(entity: unknown): number | undefined {
  const value = record(entity)?.id;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function definitionId(entity: unknown): number | undefined {
  const value = record(entity)?.definitionId;
  return typeof value === "number" && Number.isSafeInteger(value) && value !== 0 ? value : undefined;
}

export function mutationCase(value: unknown): { name: string; value: Record<string, unknown> } | undefined {
  const outer = record(value);
  const candidate = record(outer?.mutation) ?? outer;
  if (!candidate || typeof candidate.$case !== "string") return undefined;
  const payload = record(candidate.value) ?? candidate;
  return { name: candidate.$case, value: payload };
}

export function side(value: unknown): Side | undefined {
  return value === 0 || value === 1 ? value : undefined;
}
