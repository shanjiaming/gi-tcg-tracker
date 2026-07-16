import type {
  CardCatalogEntry,
  CardLedgerRow,
  DeckList,
  EntitySnapshot,
  Side,
  PublicPlayerSnapshot,
  TrackerEvent,
  TrackerFrame,
  TrackerSideSummary,
  TrackerSnapshot,
  Zone,
} from "./types.ts";
import { definitionId, entityId, mutationCase, side } from "./normalize.ts";
import { imageUrlOf, nameOf, type Catalog } from "./catalog.ts";

type Location = { side: Side; definitionId?: number; zone: Zone };
type Counters = { played: number; discarded: number; tuned: number; transferred: number; unknownExit: number };
type HandDelta = [number, number];
type PublicMutationPatches = {
  phase: string | number | undefined;
  roundNumber: number | undefined;
  currentTurn: Side | undefined;
  winner: Side | undefined;
  activeCharacterId: [number | undefined, number | undefined];
  declaredEnd: [boolean | undefined, boolean | undefined];
  legendUsed: [boolean | undefined, boolean | undefined];
};

const TERMINAL_ZONES = new Set<Zone>(["played", "discarded", "tuned", "transferred", "unknown"]);

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toZone(value: unknown): Zone | undefined {
  if (value === "hands" || value === "hand" || value === 5) return "hand";
  if (value === "pile" || value === 6) return "pile";
  if (value === "removedEntities") return "unknown";
  return undefined;
}

function isHandArea(value: unknown): boolean {
  return value === "hands" || value === "hand" || value === 5;
}

function isPileArea(value: unknown): boolean {
  return value === "pile" || value === 6;
}

function isCardArea(value: unknown): boolean {
  return isHandArea(value) || isPileArea(value);
}

function isBoardArea(value: unknown): boolean {
  return value === "character" || value === "characters" || value === 1
    || value === "combatStatus" || value === "combatStatuses" || value === 2
    || value === "summon" || value === "summons" || value === 3
    || value === "support" || value === "supports" || value === 4;
}

function isPlayedReason(value: unknown): boolean {
  const reasonCode = Number(value);
  const reasonName = String(value ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return reasonName === "EVENTCARDPLAYED" || reasonName === "EVENTCARDPLAYNOEFFECT"
    || reasonName === "EQUIPOVERRIDDEN" || reasonName === "CREATESUPPORTOVERRIDDEN"
    || reasonCode === 1 || reasonCode === 5 || reasonCode === 7 || reasonCode === 8;
}

function cardMap(deck?: DeckList): Map<number, number> {
  const result = new Map<number, number>();
  for (const id of deck?.cards ?? []) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

export class TrackerEngine {
  private readonly decks: [DeckList | undefined, DeckList | undefined];
  private readonly catalog: Catalog;
  private readonly locations = new Map<string, Location>();
  private readonly counters = new Map<string, Counters>();
  private readonly observedDefinitions = new Map<number, CardCatalogEntry>();
  private readonly events: TrackerEvent[] = [];
  private readonly warnings: string[] = [];
  private lastSequence = 0;
  private previousHands: [Set<number>, Set<number>] = [new Set(), new Set()];
  private sideValues: [TrackerSideSummary, TrackerSideSummary];
  private snapshotValue: TrackerSnapshot;

  constructor(options: {
    catalog?: Catalog;
    decks?: [DeckList | undefined, DeckList | undefined];
  } = {}) {
    this.catalog = options.catalog ?? new Map();
    this.decks = options.decks ?? [undefined, undefined];
    this.sideValues = [this.emptySide(0), this.emptySide(1)];
    this.snapshotValue = {
      sequence: 0,
      perspective: 0,
      sides: this.sideValues,
      cards: [],
      events: [],
      warnings: [],
    };
  }

  apply(frame: TrackerFrame): TrackerSnapshot {
    if (!frame || typeof frame !== "object") {
      this.warn("忽略 malformed frame");
      this.snapshotValue = { ...this.snapshotValue, warnings: [...this.warnings] };
      return freezeDeep(this.snapshotValue);
    }
    if (!frame.state || typeof frame.state !== "object" || Array.isArray(frame.state)) {
      this.warn("忽略 malformed frame state");
      this.snapshotValue = { ...this.snapshotValue, warnings: [...this.warnings] };
      return freezeDeep(this.snapshotValue);
    }
    if (frame.state.player !== undefined && !Array.isArray(frame.state.player)) {
      this.warn("忽略 malformed frame player");
      this.snapshotValue = { ...this.snapshotValue, warnings: [...this.warnings] };
      return freezeDeep(this.snapshotValue);
    }
    if (frame.perspective !== 0 && frame.perspective !== 1) {
      this.warn(`忽略非法 frame perspective=${String(frame.perspective)}`);
      this.snapshotValue = { ...this.snapshotValue, warnings: [...this.warnings] };
      return freezeDeep(this.snapshotValue);
    }
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence <= this.lastSequence) {
      this.warn(`忽略非递增 frame sequence=${String(frame.sequence)}`);
      this.snapshotValue = { ...this.snapshotValue, warnings: [...this.warnings] };
      return freezeDeep(this.snapshotValue);
    }
    this.lastSequence = frame.sequence;
    const players = Array.isArray(frame.state.player) ? frame.state.player : [];
    const mutations = Array.isArray(frame.mutations) ? frame.mutations : [];
    if (!Array.isArray(frame.mutations)) this.warn("malformed frame mutations 已被忽略");
    const touched = new Set<string>();
    const handDelta: HandDelta = [0, 0];
    const patches: PublicMutationPatches = {
      phase: undefined,
      roundNumber: undefined,
      currentTurn: undefined,
      winner: undefined,
      activeCharacterId: [undefined, undefined],
      declaredEnd: [undefined, undefined],
      legendUsed: [undefined, undefined],
    };
    for (const rawMutation of mutations) this.applyMutation(frame.sequence, frame.perspective, rawMutation, touched, handDelta, patches);
    const sideSummaries: [TrackerSideSummary, TrackerSideSummary] = [
      this.syncPlayer(frame.sequence, frame.perspective, 0, players[0], touched, handDelta, patches),
      this.syncPlayer(frame.sequence, frame.perspective, 1, players[1], touched, handDelta, patches),
    ];
    this.sideValues = sideSummaries;
    this.events.push({ sequence: frame.sequence, kind: "frame" });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    this.snapshotValue = {
      sequence: frame.sequence,
      perspective: frame.perspective,
      ...((frame.state.phase ?? patches.phase ?? this.snapshotValue.phase) === undefined ? {} : { phase: frame.state.phase ?? patches.phase ?? this.snapshotValue.phase }),
      ...((frame.state.roundNumber ?? patches.roundNumber ?? this.snapshotValue.roundNumber) === undefined ? {} : { roundNumber: frame.state.roundNumber ?? patches.roundNumber ?? this.snapshotValue.roundNumber }),
      ...((frame.state.currentTurn ?? patches.currentTurn ?? this.snapshotValue.currentTurn) === undefined ? {} : { currentTurn: frame.state.currentTurn ?? patches.currentTurn ?? this.snapshotValue.currentTurn }),
      ...((frame.state.winner ?? patches.winner ?? this.snapshotValue.winner) === undefined ? {} : { winner: frame.state.winner ?? patches.winner ?? this.snapshotValue.winner }),
      sides: sideSummaries,
      cards: this.buildRows(),
      events: [...this.events],
      warnings: [...this.warnings],
    };
    return freezeDeep(this.snapshotValue);
  }

  snapshot(): TrackerSnapshot {
    return structuredClone(this.snapshotValue);
  }

  private emptySide(who: Side): TrackerSideSummary {
    return {
      side: who,
      handCount: null,
      deckCount: null,
      knownHand: [],
      knownPile: [],
      characters: [],
      knownDeck: this.decks[who] !== undefined,
    };
  }

  private enrichEntities(entities: EntitySnapshot[] | undefined): EntitySnapshot[] | undefined {
    if (entities === undefined) return undefined;
    return entities.map((entity) => ({
      ...structuredClone(entity),
      ...(entity.definitionId !== undefined && entity.definitionId !== 0
        ? { name: nameOf(this.catalog, entity.definitionId) }
        : {}),
    }));
  }

  private knownCardsFromLocations(who: Side, zone: "hand" | "pile"): TrackerSideSummary["knownHand"] {
    const result: TrackerSideSummary["knownHand"] = [];
    for (const [key, location] of this.locations) {
      if (location.side !== who || location.zone !== zone || location.definitionId === undefined) continue;
      const separator = key.indexOf(":");
      const entityIdValue = Number(key.slice(separator + 1));
      if (!Number.isSafeInteger(entityIdValue)) continue;
      const imageUrl = imageUrlOf(this.catalog, location.definitionId);
      result.push({
        entityId: entityIdValue,
        definitionId: location.definitionId,
        name: nameOf(this.catalog, location.definitionId),
        ...(imageUrl ? { imageUrl } : {}),
      });
    }
    return result.sort((a, b) => a.entityId - b.entityId);
  }

  private knownHandFromLocations(who: Side): TrackerSideSummary["knownHand"] {
    return this.knownCardsFromLocations(who, "hand");
  }

  private knownPileFromLocations(who: Side): TrackerSideSummary["knownPile"] {
    return this.knownCardsFromLocations(who, "pile");
  }

  private syncPlayer(
    sequence: number,
    perspective: Side,
    who: Side,
    player: PublicPlayerSnapshot | undefined,
    touched: Set<string>,
    handDelta: HandDelta,
    patches: PublicMutationPatches,
  ): TrackerSideSummary {
    const previous = this.sideValues[who];
    if (!player) {
      const activeCharacterId = patches.activeCharacterId[who] ?? previous.activeCharacterId;
      const declaredEnd = patches.declaredEnd[who] ?? previous.declaredEnd;
      const legendUsed = patches.legendUsed[who] ?? previous.legendUsed;
      return {
        ...structuredClone(previous),
        handCount: previous.handCount === null ? null : Math.max(0, previous.handCount + handDelta[who]),
        knownHand: this.knownHandFromLocations(who),
        knownPile: this.knownPileFromLocations(who),
        ...(activeCharacterId === undefined ? {} : { activeCharacterId }),
        ...(declaredEnd === undefined ? {} : { declaredEnd }),
        ...(legendUsed === undefined ? {} : { legendUsed }),
      };
    }
    const hasHand = Array.isArray(player.handCard);
    const hasPile = Array.isArray(player.pileCard);
    const hasCharacters = Array.isArray(player.character);
    const hands = hasHand ? player.handCard! : [];
    const handIds = new Set<number>();
    const knownHand: TrackerSideSummary["knownHand"] = hasHand ? [] : this.knownHandFromLocations(who);
    if (hasHand) {
      for (const card of hands) {
        const id = entityId(card);
        if (id === undefined) continue;
        handIds.add(id);
        const def = who === perspective ? definitionId(card) : undefined;
        const key = this.key(who, id);
        this.locations.set(key, { side: who, definitionId: def, zone: "hand" });
        if (def !== undefined) {
          this.remember(def);
          const imageUrl = imageUrlOf(this.catalog, def);
          knownHand.push({ entityId: id, definitionId: def, name: nameOf(this.catalog, def), ...(imageUrl ? { imageUrl } : {}) });
        }
      }
      for (const oldId of this.previousHands[who]) {
        if (!handIds.has(oldId) && !touched.has(this.key(who, oldId))) {
          const location = this.locations.get(this.key(who, oldId));
          if (location && !TERMINAL_ZONES.has(location.zone)) {
            location.zone = "unknown";
            this.increment(location.definitionId, who, "unknownExit");
            this.events.push({ sequence, side: who, kind: "unknownHandExit", entityId: oldId, definitionId: location.definitionId });
            this.warn(`side ${who} hand entity ${oldId} disappeared without an exposed mutation`);
          }
        }
      }
      this.previousHands[who] = handIds;
    }
    if (hasPile) {
      for (const card of player.pileCard!) {
        const id = entityId(card);
        if (id === undefined) continue;
        const def = who === perspective ? definitionId(card) : undefined;
        if (def !== undefined) this.remember(def);
        this.locations.set(this.key(who, id), { side: who, definitionId: def, zone: "pile" });
      }
    }
    const characters = hasCharacters
      ? player.character!.map((character) => ({
        ...structuredClone(character),
        ...(character.definitionId !== undefined && character.definitionId !== 0
          ? { name: nameOf(this.catalog, character.definitionId) }
          : {}),
      }))
      : structuredClone(previous.characters);
    const combatStatus = player.combatStatus === undefined ? previous.combatStatus : this.enrichEntities(player.combatStatus);
    const summons = player.summon === undefined ? previous.summons : this.enrichEntities(player.summon);
    const supports = player.support === undefined ? previous.supports : this.enrichEntities(player.support);
    const activeCharacterId = Number.isSafeInteger(player.activeCharacterId)
      ? player.activeCharacterId
      : patches.activeCharacterId[who] ?? previous.activeCharacterId;
    const declaredEnd = player.declaredEnd ?? patches.declaredEnd[who] ?? previous.declaredEnd;
    const legendUsed = player.legendUsed ?? patches.legendUsed[who] ?? previous.legendUsed;
    const result: TrackerSideSummary = {
      side: who,
      handCount: hasHand
        ? hands.length
        : previous.handCount === null ? null : Math.max(0, previous.handCount + handDelta[who]),
      deckCount: hasPile ? player.pileCard!.length : previous.deckCount,
      knownHand: knownHand.sort((a, b) => a.entityId - b.entityId),
      knownPile: this.knownPileFromLocations(who),
      characters,
      ...(combatStatus === undefined ? {} : { combatStatus }),
      ...(summons === undefined ? {} : { summons }),
      ...(supports === undefined ? {} : { supports }),
      ...(Array.isArray(player.dice) ? { dice: [...player.dice] } : previous.dice === undefined ? {} : { dice: [...previous.dice] }),
      ...(declaredEnd === undefined ? {} : { declaredEnd }),
      ...(legendUsed === undefined ? {} : { legendUsed }),
      ...(activeCharacterId === undefined ? {} : { activeCharacterId }),
      knownDeck: this.decks[who] !== undefined,
    };
    return result;
  }

  private applyMutation(
    sequence: number,
    perspective: Side,
    raw: unknown,
    touched: Set<string>,
    handDelta: HandDelta,
    patches: PublicMutationPatches,
  ): void {
    const parsed = mutationCase(raw);
    if (!parsed) return;
    const value = parsed.value;
    const mutationSide = side(value.who ?? value.toWho ?? value.fromWho);
    if (parsed.name === "changePhase") {
      if (value.newPhase !== undefined) patches.phase = value.newPhase as string | number;
      return;
    }
    if (parsed.name === "stepRound") {
      if (this.snapshotValue.roundNumber !== undefined || patches.roundNumber !== undefined) {
        patches.roundNumber = (patches.roundNumber ?? this.snapshotValue.roundNumber!) + 1;
      }
      return;
    }
    if (parsed.name === "switchTurn") {
      const current = patches.currentTurn ?? this.snapshotValue.currentTurn;
      if (current === 0 || current === 1) patches.currentTurn = current === 0 ? 1 : 0;
      return;
    }
    if (parsed.name === "setWinner") {
      const winner = side(value.winner);
      if (winner !== undefined) patches.winner = winner;
      return;
    }
    if (parsed.name === "switchActive") {
      const characterId = Number(value.characterId);
      if (mutationSide !== undefined && Number.isSafeInteger(characterId)) patches.activeCharacterId[mutationSide] = characterId;
      return;
    }
    if (parsed.name === "setPlayerFlag") {
      const flag = String(value.flagName ?? "").toUpperCase().replace(/[^A-Z]/g, "");
      const flagValue = typeof value.flagValue === "boolean" ? value.flagValue : undefined;
      if (mutationSide !== undefined && flagValue !== undefined) {
        if (flag === "DECLAREDEND" || Number(value.flagName) === 1) patches.declaredEnd[mutationSide] = flagValue;
        if (flag === "LEGENDUSED" || Number(value.flagName) === 2) patches.legendUsed[mutationSide] = flagValue;
      }
      return;
    }
    if (parsed.name === "moveEntity") {
      const fromSide = side(value.fromWho);
      const toSide = side(value.toWho);
      const targetSide = toSide ?? fromSide;
      const sourceSide = fromSide ?? targetSide;
      const entity = record(value.entity);
      const id = entityId(entity);
      const def = definitionId(entity);
      if (id === undefined || targetSide === undefined) return;
      const sourceKey = sourceSide === undefined ? undefined : this.key(sourceSide, id);
      const previousSource = sourceKey === undefined ? undefined : this.locations.get(sourceKey);
      if (sourceSide !== undefined && isHandArea(value.fromWhere)) handDelta[sourceSide] -= 1;
      if (isHandArea(value.toWhere)) handDelta[targetSide] += 1;
      if (sourceKey !== undefined && isHandArea(value.fromWhere) && isBoardArea(value.toWhere)) {
        const playedDefinition = def ?? previousSource?.definitionId;
        touched.add(sourceKey);
        this.locations.set(sourceKey, { side: sourceSide!, definitionId: playedDefinition, zone: "played" });
        if (playedDefinition !== undefined) {
          this.remember(playedDefinition);
          this.increment(playedDefinition, sourceSide!, "played");
        }
        this.events.push({ sequence, side: sourceSide, kind: "played", entityId: id, definitionId: playedDefinition, reason: String(value.reason ?? "") });
        return;
      }
      const sourceIsCard = sourceSide !== undefined && isCardArea(value.fromWhere);
      const targetIsCard = isCardArea(value.toWhere);
      if (!sourceIsCard && !targetIsCard) return;
      const key = this.key(targetSide, id);
      if (sourceKey !== undefined && sourceKey !== key && sourceIsCard) {
        // A cross-side hand/pile move is not a play or discard. Close the
        // source location as an explicit transfer, otherwise the next full
        // hand snapshot reports a false unknown exit and overstates the
        // source deck's available cards.
        touched.add(sourceKey);
        const sourceLocation = this.locations.get(sourceKey);
        const sourceWasTerminal = sourceLocation ? TERMINAL_ZONES.has(sourceLocation.zone) : false;
        const transferredDefinition = sourceLocation?.definitionId ?? def;
        if (!sourceLocation) {
          this.locations.set(sourceKey, { side: sourceSide!, definitionId: transferredDefinition, zone: "transferred" });
        } else if (!sourceWasTerminal) {
          sourceLocation.zone = "transferred";
        }
        if (transferredDefinition !== undefined && !sourceWasTerminal) {
          this.remember(transferredDefinition);
          this.increment(transferredDefinition, sourceSide!, "transferred");
          this.events.push({ sequence, side: sourceSide, kind: "transferred", entityId: id, definitionId: transferredDefinition, reason: String(value.reason ?? "") });
        }
      }
      touched.add(key);
      const previous = this.locations.get(key);
      const nextZone = toZone(value.toWhere) ?? "unknown";
      const nextDefinition = isBoardArea(value.toWhere) || targetSide === perspective
        ? def ?? previous?.definitionId ?? previousSource?.definitionId
        : undefined;
      this.locations.set(key, { side: targetSide, definitionId: nextDefinition, zone: nextZone });
      if (nextDefinition !== undefined && (sourceIsCard || targetIsCard)) this.remember(nextDefinition);
      if (nextZone === "hand" && nextDefinition !== undefined) {
        this.events.push({ sequence, side: targetSide, kind: "drawn", entityId: id, definitionId: nextDefinition, reason: String(value.reason ?? "") });
      } else if (nextZone === "pile" && previous?.zone === "hand" && nextDefinition !== undefined) {
        this.events.push({ sequence, side: targetSide, kind: "returnedToDeck", entityId: id, definitionId: nextDefinition, reason: String(value.reason ?? "") });
      }
      return;
    }
    if (parsed.name === "removeEntity") {
      const targetSide = mutationSide;
      const entity = record(value.entity);
      const id = entityId(entity);
      if (id === undefined || targetSide === undefined) return;
      if (!isCardArea(value.where)) return;
      if (isHandArea(value.where)) handDelta[targetSide] -= 1;
      const key = this.key(targetSide, id);
      touched.add(key);
      const previous = this.locations.get(key);
      const publicPlay = isHandArea(value.where) && isPlayedReason(value.reason);
      const def = targetSide === perspective || publicPlay
        ? definitionId(entity) ?? (targetSide === perspective ? previous?.definitionId : undefined)
        : undefined;
      const rawReason = value.reason;
      const reason = String(rawReason ?? "");
      const reasonCode = Number(rawReason);
      const reasonName = reason.toUpperCase().replace(/[^A-Z]/g, "");
      const kind: "tuned" | "played" | "discarded" =
        reasonName === "ELEMENTALTUNING" || reasonCode === 2 ? "tuned"
          : reasonName === "EVENTCARDPLAYED" || reasonName === "EVENTCARDPLAYNOEFFECT"
            || reasonName === "EQUIPOVERRIDDEN" || reasonName === "CREATESUPPORTOVERRIDDEN"
            || reasonCode === 1 || reasonCode === 5 || reasonCode === 7 || reasonCode === 8 ? "played"
            : "discarded";
      if (previous && TERMINAL_ZONES.has(previous.zone)) return;
      this.locations.set(key, { side: targetSide, definitionId: def, zone: kind });
      if (def !== undefined) this.remember(def);
      this.increment(def, targetSide, kind);
      this.events.push({ sequence, side: targetSide, kind, entityId: id, definitionId: def, reason });
      return;
    }
    if (parsed.name === "createEntity") {
      const targetSide = mutationSide;
      const entity = record(value.entity);
      const id = entityId(entity);
      if (id === undefined || targetSide === undefined) return;
      if (isHandArea(value.where)) handDelta[targetSide] += 1;
      const def = !isCardArea(value.where) || targetSide === perspective ? definitionId(entity) : undefined;
      const key = this.key(targetSide, id);
      touched.add(key);
      const zone = toZone(value.where) ?? "unknown";
      this.locations.set(key, { side: targetSide, definitionId: def, zone });
      if (def !== undefined && isCardArea(value.where)) this.remember(def);
      if (value.where === "pile" || value.where === 6) {
        this.events.push({ sequence, side: targetSide, kind: "createdInDeck", entityId: id, definitionId: def });
      }
      return;
    }
    if (parsed.name === "transformDefinition") {
      const id = Number(value.entityId);
      const def = Number(value.newEntityDefinitionId);
      const inferredSide = mutationSide ?? ([0, 1] as const).find((who) => this.locations.has(this.key(who, id)));
      if ((inferredSide !== 0 && inferredSide !== 1) || !Number.isSafeInteger(id) || !Number.isSafeInteger(def)) return;
      const targetSide = inferredSide;
      const key = this.key(targetSide, id);
      const previous = this.locations.get(key);
      const visible = targetSide === perspective || (previous !== undefined && !isCardArea(previous.zone));
      this.locations.set(key, { side: targetSide, definitionId: visible ? def : undefined, zone: previous?.zone ?? "unknown" });
      if (visible && previous && isCardArea(previous.zone)) this.remember(def);
    }
  }

  private key(who: Side, id: number): string { return `${who}:${id}`; }

  private remember(definitionIdValue: number): void {
    if (this.observedDefinitions.has(definitionIdValue)) return;
    this.observedDefinitions.set(definitionIdValue, this.catalog.get(definitionIdValue) ?? {
      id: definitionIdValue,
      name: nameOf(this.catalog, definitionIdValue),
      kind: "unknown",
    });
  }

  private increment(definitionIdValue: number | undefined, who: Side, kind: keyof Counters): void {
    if (definitionIdValue === undefined) return;
    const key = this.key(who, definitionIdValue);
    const current = this.counters.get(key) ?? { played: 0, discarded: 0, tuned: 0, transferred: 0, unknownExit: 0 };
    current[kind] += 1;
    this.counters.set(key, current);
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
    if (this.warnings.length > 50) this.warnings.splice(0, this.warnings.length - 50);
  }

  private buildRows(): CardLedgerRow[] {
    const rows: CardLedgerRow[] = [];
    for (const who of [0, 1] as const) {
      const deckCounts = cardMap(this.decks[who]);
      const ids = new Set<number>([...deckCounts.keys()]);
      for (const location of this.locations.values()) {
        if (location.side === who && location.definitionId !== undefined) ids.add(location.definitionId);
      }
      for (const id of sortedNumbers(ids)) {
        const counters = this.counters.get(this.key(who, id)) ?? { played: 0, discarded: 0, tuned: 0, transferred: 0, unknownExit: 0 };
        const handCount = [...this.locations.values()].filter((entry) => entry.side === who && entry.definitionId === id && entry.zone === "hand").length;
        const pileCount = [...this.locations.values()].filter((entry) => entry.side === who && entry.definitionId === id && entry.zone === "pile").length;
        const deckCount = deckCounts.has(id) ? deckCounts.get(id)! : null;
        const remainingCount = deckCount === null
          ? null
          : Math.max(0, deckCount - handCount - counters.played - counters.discarded - counters.tuned - counters.transferred - counters.unknownExit);
        const unplayedCount = deckCount === null
          ? null
          : Math.max(0, deckCount - counters.played);
        if (deckCount !== null || handCount > 0 || pileCount > 0 || counters.played + counters.discarded + counters.tuned + counters.transferred + counters.unknownExit > 0) {
          rows.push({
            side: who,
            definitionId: id,
            name: nameOf(this.catalog, id),
            ...(imageUrlOf(this.catalog, id) ? { imageUrl: imageUrlOf(this.catalog, id) } : {}),
            deckCount,
            handCount,
            pileCount,
            remainingCount,
            unplayedCount,
            playedCount: counters.played,
            discardedCount: counters.discarded,
            tunedCount: counters.tuned,
            transferredCount: counters.transferred,
            unknownExitCount: counters.unknownExit,
          });
        }
      }
    }
    return rows.sort((a, b) => a.side - b.side || a.definitionId - b.definitionId);
  }
}
