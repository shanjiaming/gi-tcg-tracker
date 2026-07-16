import type { CharacterSnapshot, EntitySnapshot, PublicPlayerSnapshot, Side, TrackerFrame } from "../types.ts";

// A real Genius Invokation deck is small; this bound leaves room for generated
// pile entities while preventing malformed DOM data from causing an enormous
// synthetic-entity allocation loop.
const MAX_VISIBLE_ZONE_COUNT = 256;
const MAX_PUBLIC_ENTITY_COUNT = 256;
const MAX_CHARACTER_COUNT = 16;
const MAX_ENTITY_DEPTH = 8;
const MAX_EXPOSED_MUTATIONS = 1024;

export interface HtmlCardObservation {
  definitionId?: number;
  entityId?: number;
  known?: boolean;
}

export interface HtmlCharacterObservation {
  definitionId?: number;
  entityId?: number;
  defeated?: boolean;
  health?: number;
  maxHealth?: number;
  energy?: number;
  maxEnergy?: number;
}

export interface HtmlEntityObservation {
  definitionId?: number;
  entityId?: number;
  variableName?: string;
  variableValue?: number;
  attachment?: HtmlEntityObservation[];
}

export interface HtmlPlayerObservation {
  activeCharacterId?: number;
  hand: HtmlCardObservation[];
  handCount?: number;
  pile: HtmlCardObservation[];
  pileCount?: number;
  characters: HtmlCharacterObservation[];
  combatStatus?: HtmlEntityObservation[];
  summons?: HtmlEntityObservation[];
  supports?: HtmlEntityObservation[];
  dice?: Array<string | number>;
  declaredEnd?: boolean;
  legendUsed?: boolean;
}

/**
 * The deliberately small contract expected from a DOM/content-script reader.
 * It contains only facts explicitly visible in the page. Missing card identity
 * is represented by an omitted definitionId and never inferred from position.
 */
export interface HtmlObservation {
  sequence: number;
  perspective: Side;
  phase?: string | number;
  roundNumber?: number;
  currentTurn?: Side;
  winner?: Side;
  players: [HtmlPlayerObservation, HtmlPlayerObservation];
  exposedMutations?: unknown[];
}

function safeId(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validSide(value: unknown): Side | undefined {
  return value === 0 || value === 1 ? value : undefined;
}

function nonNegativeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_VISIBLE_ZONE_COUNT
    ? Number(value)
    : undefined;
}

function visibleDefinition(card: HtmlCardObservation): number | undefined {
  if (card.known === false) return undefined;
  const id = safeId(card.definitionId);
  return id === undefined || id === 0 ? undefined : id;
}

function syntheticCardId(
  who: Side,
  zone: "hand" | "pile",
  card: HtmlCardObservation,
  index: number,
  occurrence: number,
): number {
  const explicit = safeId(card.entityId);
  if (explicit !== undefined) return explicit;
  const zoneOffset = zone === "hand" ? 0 : 1000000;
  const definition = visibleDefinition(card);
  if (definition !== undefined) return -700000 - zoneOffset - who * 10000000 - definition * 10 - occurrence;
  return -800000 - zoneOffset - who * 10000 - index;
}

function cardEntities(who: Side, zone: "hand" | "pile", cards: HtmlCardObservation[]): EntitySnapshot[] {
  const occurrences = new Map<number, number>();
  return cards.map((card, index) => {
    const definition = visibleDefinition(card);
    const occurrence = definition === undefined ? 0 : occurrences.get(definition) ?? 0;
    if (definition !== undefined) occurrences.set(definition, occurrence + 1);
    return {
      id: syntheticCardId(who, zone, card, index, occurrence),
      definitionId: definition ?? 0,
    };
  });
}

function characterEntities(who: Side, characters: HtmlCharacterObservation[]): CharacterSnapshot[] {
  return characters.map((character, index) => ({
    id: safeId(character.entityId) ?? -900000 - who * 10000 - index,
    definitionId: safeId(character.definitionId) ?? 0,
    ...(typeof character.defeated === "boolean" ? { defeated: character.defeated } : {}),
    ...(Number.isSafeInteger(character.health) ? { health: character.health } : {}),
    ...(Number.isSafeInteger(character.maxHealth) ? { maxHealth: character.maxHealth } : {}),
    ...(Number.isSafeInteger(character.energy) ? { energy: character.energy } : {}),
    ...(Number.isSafeInteger(character.maxEnergy) ? { maxEnergy: character.maxEnergy } : {}),
    entity: [],
  }));
}

function publicEntities(entities: HtmlEntityObservation[]): EntitySnapshot[] {
  return entities.map((entity) => ({
    ...(safeId(entity.entityId) === undefined ? {} : { id: safeId(entity.entityId) }),
    ...(safeId(entity.definitionId) === undefined ? {} : { definitionId: safeId(entity.definitionId) }),
    ...(typeof entity.variableName === "string" ? { variableName: entity.variableName } : {}),
    ...(Number.isSafeInteger(entity.variableValue) ? { variableValue: entity.variableValue } : {}),
    ...(Array.isArray(entity.attachment) ? { attachment: publicEntities(entity.attachment) } : {}),
  }));
}

function normalizeCard(value: unknown): HtmlCardObservation | undefined {
  const source = objectRecord(value);
  if (!source) return undefined;
  const known = source?.known;
  return {
    ...(safeId(source?.definitionId) === undefined ? {} : { definitionId: safeId(source?.definitionId) }),
    ...(safeId(source?.entityId) === undefined ? {} : { entityId: safeId(source?.entityId) }),
    ...(known === undefined ? {} : { known: known === true }),
  };
}

function normalizeCharacter(value: unknown): HtmlCharacterObservation | undefined {
  const source = objectRecord(value);
  if (!source) return undefined;
  return {
    ...(safeId(source?.definitionId) === undefined ? {} : { definitionId: safeId(source?.definitionId) }),
    ...(safeId(source?.entityId) === undefined ? {} : { entityId: safeId(source?.entityId) }),
    ...(typeof source?.defeated === "boolean" ? { defeated: source.defeated } : {}),
    ...(Number.isSafeInteger(source?.health) ? { health: Number(source?.health) } : {}),
    ...(Number.isSafeInteger(source?.maxHealth) ? { maxHealth: Number(source?.maxHealth) } : {}),
    ...(Number.isSafeInteger(source?.energy) ? { energy: Number(source?.energy) } : {}),
    ...(Number.isSafeInteger(source?.maxEnergy) ? { maxEnergy: Number(source?.maxEnergy) } : {}),
  };
}

function normalizeEntity(value: unknown, depth = 0): HtmlEntityObservation | undefined {
  if (depth > MAX_ENTITY_DEPTH) return undefined;
  const source = objectRecord(value);
  if (!source) return undefined;
  let attachment: HtmlEntityObservation[] | undefined;
  if (source.attachment !== undefined) {
    if (!Array.isArray(source.attachment) || source.attachment.length > MAX_PUBLIC_ENTITY_COUNT) return undefined;
    const children = source.attachment.map((child) => normalizeEntity(child, depth + 1));
    if (children.some((child) => child === undefined)) return undefined;
    attachment = children as HtmlEntityObservation[];
  }
  return {
    ...(safeId(source?.definitionId) === undefined ? {} : { definitionId: safeId(source?.definitionId) }),
    ...(safeId(source?.entityId) === undefined ? {} : { entityId: safeId(source?.entityId) }),
    ...(typeof source?.variableName === "string" ? { variableName: source.variableName } : {}),
    ...(Number.isSafeInteger(source?.variableValue) ? { variableValue: Number(source?.variableValue) } : {}),
    ...(attachment === undefined ? {} : { attachment }),
  };
}

function normalizePlayer(value: unknown): HtmlPlayerObservation | undefined {
  const source = objectRecord(value);
  if (!source || !Array.isArray(source.hand) || !Array.isArray(source.pile) || !Array.isArray(source.characters)
    || source.hand.length > MAX_VISIBLE_ZONE_COUNT || source.pile.length > MAX_VISIBLE_ZONE_COUNT
    || source.characters.length > MAX_CHARACTER_COUNT) return undefined;
  const handCount = source.handCount === undefined ? undefined : nonNegativeCount(source.handCount);
  const pileCount = source.pileCount === undefined ? undefined : nonNegativeCount(source.pileCount);
  if ((source.handCount !== undefined && handCount === undefined)
    || (source.pileCount !== undefined && pileCount === undefined)
    || (handCount !== undefined && handCount < source.hand.length)
    || (pileCount !== undefined && pileCount < source.pile.length)) return undefined;
  const optionalEntities = (field: string): HtmlEntityObservation[] | null | undefined => {
    if (source[field] === undefined) return undefined;
    if (!Array.isArray(source[field]) || source[field].length > MAX_PUBLIC_ENTITY_COUNT) return null;
    const entities = source[field].map(normalizeEntity);
    return entities.some((entity) => entity === undefined) ? null : entities as HtmlEntityObservation[];
  };
  const combatStatus = optionalEntities("combatStatus");
  const summons = optionalEntities("summons");
  const supports = optionalEntities("supports");
  if (combatStatus === null || summons === null || supports === null) return undefined;
  const dice = source.dice === undefined
    ? undefined
    : Array.isArray(source.dice) && source.dice.length <= MAX_VISIBLE_ZONE_COUNT
      && source.dice.every((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))
      ? [...source.dice] as Array<string | number>
      : null;
  if (dice === null
    || (source.activeCharacterId !== undefined && !Number.isSafeInteger(source.activeCharacterId))
    || (source.declaredEnd !== undefined && typeof source.declaredEnd !== "boolean")
    || (source.legendUsed !== undefined && typeof source.legendUsed !== "boolean")) return undefined;
  const hand = source.hand.map(normalizeCard);
  const pile = source.pile.map(normalizeCard);
  const characters = source.characters.map(normalizeCharacter);
  if (hand.some((card) => card === undefined) || pile.some((card) => card === undefined)
    || characters.some((character) => character === undefined)) return undefined;
  return {
    hand: hand as HtmlCardObservation[],
    ...(handCount === undefined ? {} : { handCount }),
    pile: pile as HtmlCardObservation[],
    ...(pileCount === undefined ? {} : { pileCount }),
    characters: characters as HtmlCharacterObservation[],
    ...(combatStatus === undefined ? {} : { combatStatus }),
    ...(summons === undefined ? {} : { summons }),
    ...(supports === undefined ? {} : { supports }),
    ...(source.activeCharacterId === undefined ? {} : { activeCharacterId: Number(source.activeCharacterId) }),
    ...(dice === undefined ? {} : { dice }),
    ...(typeof source.declaredEnd === "boolean" ? { declaredEnd: source.declaredEnd } : {}),
    ...(typeof source.legendUsed === "boolean" ? { legendUsed: source.legendUsed } : {}),
  };
}

function hasDuplicateCardEntityIds(who: Side, player: HtmlPlayerObservation): boolean {
  const ids = new Set<number>();
  const rendered = [
    ...cardEntities(who, "hand", player.hand),
    ...cardEntities(who, "pile", player.pile),
  ];
  for (const card of rendered) {
    const id = safeId(card.id);
    if (id === undefined) continue;
    if (ids.has(id)) return true;
    ids.add(id);
  }
  return false;
}

function invalidFrame(): TrackerFrame {
  return { sequence: Number.NaN, perspective: 2 as Side, state: {}, mutations: [] };
}

function playerFromHtml(who: Side, input: HtmlPlayerObservation): PublicPlayerSnapshot {
  const hand = cardEntities(who, "hand", input.hand);
  const pile = cardEntities(who, "pile", input.pile);
  while (hand.length < (input.handCount ?? hand.length)) {
    hand.push({ id: -810000 - who * 10000 - hand.length, definitionId: 0 });
  }
  while (pile.length < (input.pileCount ?? pile.length)) {
    pile.push({ id: -820000 - who * 10000 - pile.length, definitionId: 0 });
  }
  return {
    ...(Number.isSafeInteger(input.activeCharacterId) ? { activeCharacterId: input.activeCharacterId } : {}),
    handCard: hand,
    pileCard: pile,
    character: characterEntities(who, input.characters),
    ...(input.combatStatus === undefined ? {} : { combatStatus: publicEntities(input.combatStatus) }),
    ...(input.summons === undefined ? {} : { summon: publicEntities(input.summons) }),
    ...(input.supports === undefined ? {} : { support: publicEntities(input.supports) }),
    ...(Array.isArray(input.dice) ? { dice: [...input.dice] } : {}),
    ...(typeof input.declaredEnd === "boolean" ? { declaredEnd: input.declaredEnd } : {}),
    ...(typeof input.legendUsed === "boolean" ? { legendUsed: input.legendUsed } : {}),
  };
}

export function frameFromHtml(observation: HtmlObservation | unknown): TrackerFrame {
  const source = objectRecord(observation);
  const rawPlayers = source?.players;
  if (!source || !Array.isArray(rawPlayers) || rawPlayers.length !== 2) return invalidFrame();
  const players = [normalizePlayer(rawPlayers[0]), normalizePlayer(rawPlayers[1])] as const;
  if (!players[0] || !players[1] || hasDuplicateCardEntityIds(0, players[0]) || hasDuplicateCardEntityIds(1, players[1])) return invalidFrame();
  if (source.exposedMutations !== undefined
    && (!Array.isArray(source.exposedMutations) || source.exposedMutations.length > MAX_EXPOSED_MUTATIONS)) return invalidFrame();
  const perspective = validSide(source.perspective);
  const sequence = safeId(source.sequence);
  if (perspective === undefined || sequence === undefined) return invalidFrame();
  const currentTurn = validSide(source.currentTurn);
  const winner = validSide(source.winner);
  const mutations = source.exposedMutations === undefined
    ? []
    : Array.isArray(source.exposedMutations) ? [...source.exposedMutations] : [];
  return {
    sequence,
    perspective,
    state: {
      ...(typeof source.phase === "string" || typeof source.phase === "number" ? { phase: source.phase } : {}),
      ...(Number.isSafeInteger(source.roundNumber) ? { roundNumber: Number(source.roundNumber) } : {}),
      ...(currentTurn === undefined ? {} : { currentTurn }),
      ...(winner === undefined ? {} : { winner }),
      player: [playerFromHtml(0, players[0]), playerFromHtml(1, players[1])],
    },
    // A DOM reader has no mutation authority. Only a separately verified event
    // channel may populate this field; otherwise the engine will warn on exit.
    mutations,
  };
}
