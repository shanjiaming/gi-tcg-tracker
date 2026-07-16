export type Side = 0 | 1;
export type Zone = "hand" | "pile" | "played" | "discarded" | "tuned" | "transferred" | "unknown";

export interface DeckList {
  characters: number[];
  cards: number[];
}

export interface CardCatalogEntry {
  id: number;
  name: string;
  kind: "card" | "character" | "skill" | "entity" | "unknown";
  imageUrl?: string;
}

export type EntitySnapshot = {
  id?: number;
  definitionId?: number;
  name?: string;
  type?: string | number;
  variableName?: string;
  variableValue?: number;
  attachment?: EntitySnapshot[];
};

export interface CharacterSnapshot {
  id?: number;
  definitionId?: number;
  name?: string;
  defeated?: boolean;
  health?: number;
  maxHealth?: number;
  energy?: number;
  maxEnergy?: number;
  aura?: string | number;
  entity?: EntitySnapshot[];
}

export interface PublicPlayerSnapshot {
  activeCharacterId?: number;
  character?: CharacterSnapshot[];
  combatStatus?: EntitySnapshot[];
  summon?: EntitySnapshot[];
  support?: EntitySnapshot[];
  dice?: Array<string | number>;
  pileCard?: EntitySnapshot[];
  handCard?: EntitySnapshot[];
  declaredEnd?: boolean;
  legendUsed?: boolean;
  status?: string | number;
}

export interface TrackerFrame {
  sequence: number;
  perspective: Side;
  state: {
    phase?: string | number;
    roundNumber?: number;
    currentTurn?: Side;
    winner?: Side;
    player?: PublicPlayerSnapshot[];
  };
  mutations: unknown[];
}

export interface TrackerEvent {
  sequence: number;
  side?: Side;
  kind:
    | "frame"
    | "played"
    | "discarded"
    | "tuned"
    | "transferred"
    | "returnedToDeck"
    | "drawn"
    | "createdInDeck"
    | "unknownHandExit"
    | "warning";
  definitionId?: number;
  entityId?: number;
  reason?: string;
  message?: string;
}

export interface CardLedgerRow {
  side: Side;
  definitionId: number;
  name: string;
  imageUrl?: string;
  deckCount: number | null;
  handCount: number;
  remainingCount: number | null;
  unplayedCount: number | null;
  playedCount: number;
  discardedCount: number;
  tunedCount: number;
  transferredCount: number;
  unknownExitCount: number;
}

export interface KnownCardSnapshot {
  entityId: number;
  definitionId: number;
  name: string;
  imageUrl?: string;
}

export interface TrackerSideSummary {
  side: Side;
  handCount: number | null;
  deckCount: number | null;
  knownHand: KnownCardSnapshot[];
  knownPile: KnownCardSnapshot[];
  characters: CharacterSnapshot[];
  combatStatus?: EntitySnapshot[];
  summons?: EntitySnapshot[];
  supports?: EntitySnapshot[];
  dice?: Array<string | number>;
  declaredEnd?: boolean;
  legendUsed?: boolean;
  activeCharacterId?: number;
  knownDeck: boolean;
}

export interface TrackerSnapshot {
  sequence: number;
  perspective: Side;
  phase?: string | number;
  roundNumber?: number;
  currentTurn?: Side;
  winner?: Side;
  sides: [TrackerSideSummary, TrackerSideSummary];
  cards: CardLedgerRow[];
  events: TrackerEvent[];
  warnings: string[];
}
