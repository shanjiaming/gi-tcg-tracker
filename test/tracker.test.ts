import assert from "node:assert/strict";
import test from "node:test";
import { catalogFromObject } from "../src/catalog.ts";
import { frameFromHtml } from "../src/adapters/html.ts";
import { TrackerEngine } from "../src/engine.ts";
import { frameFromNotification } from "../src/normalize.ts";
import { normalizeDeck } from "../src/decks.ts";

const catalog = catalogFromObject({ cards: {
  "1411": { id: 1411, name: "莫娜", kind: "character" },
  "303202": { id: 303202, name: "公开战斗状态", kind: "entity" },
  "333001": { id: 333001, name: "绝云锅巴", kind: "card" },
  "333002": { id: 333002, name: "仙跳墙", kind: "card" },
  "301020": { id: 301020, name: "禁忌知识", kind: "card" },
  "301021": { id: 301021, name: "禁忌知识（冷却中）", kind: "entity" },
} });
const deck = { characters: [1411, 1510, 2103], cards: [333001, 333001, 333002] };

test("normalizes an automatically supplied room deck and rejects malformed identities", () => {
  assert.deepEqual(normalizeDeck({ characters: [1411, 1510, 2103], cards: [333001, 333002] }), {
    characters: [1411, 1510, 2103],
    cards: [333001, 333002],
  });
  assert.equal(normalizeDeck({ characters: [1411, "bad"], cards: [333001] }), undefined);
  assert.equal(normalizeDeck({ characters: [], cards: "hidden" }), undefined);
  assert.equal(normalizeDeck({ characters: Array.from({ length: 17 }, () => 1411), cards: [] }), undefined);
  assert.equal(normalizeDeck({ characters: [], cards: Array.from({ length: 257 }, () => 333001) }), undefined);
});

test("tracks visible hand and an exposed played-card mutation", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3, roundNumber: 1, currentTurn: 0,
    player: [
      { activeCharacterId: -1, handCard: [{ id: -10, definitionId: 333001 }], pileCard: [{ id: -11, definitionId: 333002 }], character: [] },
      { handCard: [{ id: -20, definitionId: 0 }], pileCard: [{ id: -21, definitionId: 0 }], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3, roundNumber: 1, currentTurn: 0,
    player: [
      { activeCharacterId: -1, handCard: [], pileCard: [{ id: -11, definitionId: 333002 }], character: [] },
      { handCard: [{ id: -20, definitionId: 0 }], pileCard: [{ id: -21, definitionId: 0 }], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: { who: 0, where: "hands", reason: "EVENT_CARD_PLAYED", entity: { id: -10, definitionId: 333001 } } } }]));
  const row = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  assert.equal(row?.playedCount, 1);
  assert.equal(row?.handCount, 0);
  assert.equal(row?.remainingCount, 1);
  assert.deepEqual(snapshot.sides[0].knownPile.map((card) => card.definitionId), [333002]);
  assert.match(snapshot.sides[0].knownPile[0]?.imageUrl ?? "", /static-data\.piovium\.org\/api\/v4\/image\/333002/);
  assert.match(row?.imageUrl ?? "", /static-data\.piovium\.org\/api\/v4\/image\/333001/);
});

test("computes an opponent unplayed count when the simulator supplies the opponent deck", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, deck] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -20, definitionId: 0 }], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: {
    who: 1, where: "hands", reason: "EVENT_CARD_PLAYED", entity: { id: -20, definitionId: 333001 },
  } } }]));
  const row = snapshot.cards.find((item) => item.side === 1 && item.definitionId === 333001);
  assert.equal(snapshot.sides[1].knownDeck, true);
  assert.equal(row?.deckCount, 2);
  assert.equal(row?.playedCount, 1);
  assert.equal(row?.unplayedCount, 1);
});

test("keeps a simulator-created local pile card visible beside the imported deck", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [{ id: -30, definitionId: 301020 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "createEntity", value: {
    who: 0, where: "pile", entity: { id: -30, definitionId: 301020 },
  } } }]));
  const row = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 301020);
  assert.equal(row?.deckCount, null);
  assert.equal(row?.pileCount, 1);
  assert.deepEqual(snapshot.sides[0].knownPile.map((card) => card.definitionId), [301020]);
});

test("updates a visible generated pile identity on transformDefinition", () => {
  const engine = new TrackerEngine({ catalog, decks: [undefined, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [{ id: -30, definitionId: 301020 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "createEntity", value: {
    who: 0, where: "pile", entity: { id: -30, definitionId: 301020 },
  } } }]));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [{ id: -30, definitionId: 301021 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "transformDefinition", value: {
    entityId: -30, newEntityDefinitionId: 301021,
  } } }]));
  assert.deepEqual(snapshot.sides[0].knownPile.map((card) => card.definitionId), [301021]);
  assert.equal(snapshot.cards.some((card) => card.definitionId === 301021 && card.side === 0), true);
  assert.equal(snapshot.warnings.length, 0);
});

test("counts equipment-overridden hand removal as played", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: {
    who: 0, where: 5, reason: 7, entity: { id: -10, definitionId: 333001 },
  } } }]));
  const row = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  assert.equal(row?.playedCount, 1);
  assert.equal(row?.discardedCount, 0);
  assert.equal(snapshot.warnings.length, 0);
});

test("classifies local tuning and discard removals independently", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }, { id: -11, definitionId: 333002 }], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [
    { mutation: { $case: "removeEntity", value: { who: 0, where: 5, reason: 2, entity: { id: -10, definitionId: 333001 } } } },
    { mutation: { $case: "removeEntity", value: { who: 0, where: 5, reason: 3, entity: { id: -11, definitionId: 333002 } } } },
  ]));
  const tuned = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  const discarded = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333002);
  assert.equal(tuned?.tunedCount, 1);
  assert.equal(tuned?.discardedCount, 0);
  assert.equal(discarded?.discardedCount, 1);
  assert.equal(discarded?.tunedCount, 0);
  assert.equal(snapshot.warnings.length, 0);
});

test("records local hand-to-pile and pile-to-hand events without consuming the card", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 1,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [{ id: -11, definitionId: 0 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  engine.apply(frameFromNotification(2, 0, {
    phase: 1,
    player: [
      { handCard: [], pileCard: [{ id: -11, definitionId: 0 }, { id: -10, definitionId: 333001 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 0, fromWhere: 5, toWho: 0, toWhere: 6, reason: 1,
    entity: { id: -10, definitionId: 333001 },
  } } }]));
  const snapshot = engine.apply(frameFromNotification(3, 0, {
    phase: 2,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [{ id: -11, definitionId: 0 }], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 0, fromWhere: 6, toWho: 0, toWhere: 5, reason: 2,
    entity: { id: -10, definitionId: 333001 },
  } } }]));
  const row = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  assert.equal(row?.playedCount, 0);
  assert.equal(row?.discardedCount, 0);
  assert.equal(row?.tunedCount, 0);
  assert.equal(row?.handCount, 1);
  assert.equal(snapshot.events.some((event) => event.kind === "returnedToDeck" && event.entityId === -10), true);
  assert.equal(snapshot.events.some((event) => event.kind === "drawn" && event.entityId === -10), true);
  assert.equal(snapshot.warnings.length, 0);
});

test("engine fails closed on malformed frame boundaries", () => {
  const engine = new TrackerEngine({ catalog });
  const malformedFrame = engine.apply(null as never);
  assert.equal(malformedFrame.sequence, 0);
  assert.match(malformedFrame.warnings.join("\n"), /malformed frame/);

  const malformedState = engine.apply({ sequence: 1, perspective: 0, state: null, mutations: [] } as never);
  assert.equal(malformedState.sequence, 0);
  assert.match(malformedState.warnings.join("\n"), /malformed frame state/);

  const malformedPlayer = engine.apply({ sequence: 1, perspective: 0, state: { player: {} }, mutations: [] } as never);
  assert.equal(malformedPlayer.sequence, 0);
  assert.match(malformedPlayer.warnings.join("\n"), /malformed frame player/);

  const malformedPerspective = engine.apply({ sequence: 1, perspective: 2, state: {}, mutations: [] } as never);
  assert.equal(malformedPerspective.sequence, 0);
  assert.match(malformedPerspective.warnings.join("\n"), /非法 frame perspective/);

  const malformedMutations = engine.apply({ sequence: 1, perspective: 0, state: { player: [] }, mutations: {} } as never);
  assert.equal(malformedMutations.sequence, 1);
  assert.match(malformedMutations.warnings.join("\n"), /malformed frame mutations/);
});

test("engine apply returns an isolated snapshot", () => {
  const engine = new TrackerEngine({ catalog });
  const returned = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  assert.throws(() => { returned.sides[0].handCount = 999; }, TypeError);
  assert.throws(() => { returned.warnings.push("caller mutation"); }, TypeError);
  const internal = engine.snapshot();
  assert.equal(internal.sides[0].handCount, 0);
  assert.equal(internal.warnings.includes("caller mutation"), false);
});

test("names public characters and marks the active character", () => {
  const engine = new TrackerEngine({ catalog });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      {
        activeCharacterId: -11,
        handCard: [],
        pileCard: [],
        character: [
          { id: -11, definitionId: 1411, health: 8, maxHealth: 10, energy: 1, maxEnergy: 3 },
        ],
      },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  assert.equal(snapshot.sides[0].activeCharacterId, -11);
  assert.equal(snapshot.sides[0].characters[0]?.name, "莫娜");
  assert.equal(snapshot.sides[0].characters[0]?.health, 8);
});

test("preserves public statuses, summons, dice and flags without naming masked entities", () => {
  const engine = new TrackerEngine({ catalog });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      {
        handCard: [],
        pileCard: [],
        character: [],
        combatStatus: [{ id: -30, definitionId: 303202 }],
        summon: [{ id: -31, definitionId: 303202 }],
        support: [{ id: -32, definitionId: 0 }],
        dice: [1, 8],
        declaredEnd: true,
        legendUsed: true,
      },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  assert.equal(snapshot.sides[0].combatStatus?.[0]?.name, "公开战斗状态");
  assert.equal(snapshot.sides[0].summons?.[0]?.name, "公开战斗状态");
  assert.equal(snapshot.sides[0].supports?.[0]?.name, undefined);
  assert.deepEqual(snapshot.sides[0].dice, [1, 8]);
  assert.equal(snapshot.sides[0].declaredEnd, true);
  assert.equal(snapshot.sides[0].legendUsed, true);
});

test("does not invent an opponent card identity from a masked mutation", () => {
  const engine = new TrackerEngine({ catalog, decks: [undefined, undefined] });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3, player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -20, definitionId: 0 }], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: { who: 1, where: "hands", reason: "EVENT_CARD_PLAYED", entity: { id: -20, definitionId: 0 } } } }]));
  assert.equal(snapshot.cards.some((item) => item.side === 1 && item.definitionId !== 0), false);
  assert.equal(snapshot.sides[1].knownHand.length, 0);
});

test("masks exact opponent hand/pile mutation identities but keeps public plays", () => {
  const engine = new TrackerEngine({ catalog, decks: [undefined, undefined] });
  const hiddenCreate = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -20, definitionId: 0 }], pileCard: [{ id: -21, definitionId: 0 }], character: [] },
    ],
  }, [{ mutation: { $case: "createEntity", value: {
    who: 1, where: 6, entity: { id: -21, definitionId: 333001 },
  } } }]));
  assert.equal(hiddenCreate.sides[1].knownHand.length, 0);
  assert.equal(hiddenCreate.cards.some((row) => row.side === 1 && row.definitionId !== 0), false);

  const hiddenMove = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -21, definitionId: 0 }], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 1, fromWhere: 6, toWho: 1, toWhere: 5, reason: 2,
    entity: { id: -21, definitionId: 333002 },
  } } }]));
  assert.equal(hiddenMove.sides[1].knownHand.length, 0);
  assert.equal(hiddenMove.cards.some((row) => row.side === 1 && row.definitionId !== 0), false);

  const publicPlay = engine.apply(frameFromNotification(3, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: {
    who: 1, where: 5, reason: 1, entity: { id: -21, definitionId: 333001 },
  } } }]));
  const row = publicPlay.cards.find((item) => item.side === 1 && item.definitionId === 333001);
  assert.equal(row?.playedCount, 1);
  assert.equal(publicPlay.sides[1].knownHand.length, 0);
});

test("ignores a repeated frame and records an unbound hand disappearance as warning", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  const frame = frameFromNotification(1, 0, { player: [{ handCard: [{ id: -1, definitionId: 333002 },], pileCard: [], character: [] }, { handCard: [], pileCard: [], character: [] }] });
  engine.apply(frame);
  const repeated = engine.apply(frame);
  assert.match(repeated.warnings.join("\n"), /非递增/);
  const snapshot = engine.apply(frameFromNotification(2, 0, { player: [{ handCard: [], pileCard: [], character: [] }, { handCard: [], pileCard: [], character: [] }] }));
  assert.equal(snapshot.sequence, 2);
  assert.match(snapshot.warnings.join("\n"), /disappeared/);
});

test("partial player state preserves prior public facts without inventing a hand exit", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      {
        activeCharacterId: -11,
        handCard: [{ id: -1, definitionId: 333001 }],
        pileCard: [{ id: -2, definitionId: 0 }],
        character: [{ id: -11, definitionId: 1411, health: 8, maxHealth: 10 }],
        dice: [1, 8],
        declaredEnd: true,
      },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 4,
    player: [{ dice: [2, 8] }],
  }));
  assert.equal(snapshot.sides[0].handCount, 1);
  assert.equal(snapshot.sides[0].deckCount, 1);
  assert.equal(snapshot.sides[0].knownHand[0]?.definitionId, 333001);
  assert.equal(snapshot.sides[0].characters[0]?.name, "莫娜");
  assert.equal(snapshot.sides[0].activeCharacterId, -11);
  assert.deepEqual(snapshot.sides[0].dice, [2, 8]);
  assert.equal(snapshot.sides[0].declaredEnd, true);
  assert.equal(snapshot.warnings.length, 0);
});

test("partial top-level state preserves the latest phase metadata", () => {
  const engine = new TrackerEngine();
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    roundNumber: 2,
    currentTurn: 1,
    winner: 0,
    player: [{ handCard: [], pileCard: [], character: [] }, { handCard: [], pileCard: [], character: [] }],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    player: [{ dice: [1] }, { dice: [2] }],
  }));
  assert.equal(snapshot.phase, 3);
  assert.equal(snapshot.roundNumber, 2);
  assert.equal(snapshot.currentTurn, 1);
  assert.equal(snapshot.winner, 0);
});

test("counts explicit hand-to-board moves as played cards", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [], support: [{ id: -10, definitionId: 333001 }] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 0, fromWhere: 5, toWho: 0, toWhere: 4, reason: 7,
    entity: { id: -10, definitionId: 333001 },
  } } }]));
  const row = snapshot.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  assert.equal(row?.playedCount, 1);
  assert.equal(row?.handCount, 0);
  assert.equal(row?.remainingCount, 1);
  assert.equal(snapshot.warnings.length, 0);
});

test("closes a cross-side hand transfer without a false unknown exit", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -10, definitionId: 0 }], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 0, fromWhere: 5, toWho: 1, toWhere: 5, reason: 4,
    entity: { id: -10, definitionId: 333001 },
  } } }]));
  assert.equal(snapshot.sides[0].handCount, 0);
  assert.equal(snapshot.sides[1].handCount, 1);
  assert.equal(snapshot.warnings.length, 0);
  const row = snapshot.cards.find((row) => row.side === 0 && row.definitionId === 333001);
  assert.equal(row?.unknownExitCount, 0);
  assert.equal(row?.transferredCount, 1);
  assert.equal(row?.remainingCount, 1);
  const repeated = engine.apply(frameFromNotification(3, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [] },
      { handCard: [{ id: -10, definitionId: 0 }], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "moveEntity", value: {
    fromWho: 0, fromWhere: 5, toWho: 1, toWhere: 5, reason: 4,
    entity: { id: -10, definitionId: 333001 },
  } } }]));
  const repeatedRow = repeated.cards.find((item) => item.side === 0 && item.definitionId === 333001);
  assert.equal(repeatedRow?.transferredCount, 1);
});

test("partial notification mutation updates hand count even without a player payload", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [{ id: -10, definitionId: 333001 }], pileCard: [], character: [] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
  }, [{ mutation: { $case: "removeEntity", value: {
    who: 0, where: 5, reason: 5, entity: { id: -10, definitionId: 333001 },
  } } }]));
  assert.equal(snapshot.sides[0].handCount, 0);
  assert.equal(snapshot.sides[0].knownHand.length, 0);
  assert.equal(snapshot.cards.find((item) => item.definitionId === 333001)?.playedCount, 1);
  assert.equal(snapshot.warnings.length, 0);
});

test("partial public mutations update active character and player flags", () => {
  const engine = new TrackerEngine({ catalog });
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { activeCharacterId: -11, handCard: [], pileCard: [], character: [] },
      { activeCharacterId: -21, handCard: [], pileCard: [], character: [] },
    ],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {
    phase: 3,
  }, [
    { mutation: { $case: "switchActive", value: { who: 0, characterId: -12 } } },
    { mutation: { $case: "setPlayerFlag", value: { who: 0, flagName: "DECLARED_END", flagValue: true } } },
    { mutation: { $case: "setPlayerFlag", value: { who: 1, flagName: 2, flagValue: true } } },
  ]));
  assert.equal(snapshot.sides[0].activeCharacterId, -12);
  assert.equal(snapshot.sides[0].declaredEnd, true);
  assert.equal(snapshot.sides[1].legendUsed, true);
  assert.equal(snapshot.warnings.length, 0);
});

test("partial top-level mutations preserve phase, round, turn and winner", () => {
  const engine = new TrackerEngine();
  engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    roundNumber: 2,
    currentTurn: 0,
    player: [{ handCard: [], pileCard: [], character: [] }, { handCard: [], pileCard: [], character: [] }],
  }));
  const snapshot = engine.apply(frameFromNotification(2, 0, {}, [
    { mutation: { $case: "changePhase", value: { newPhase: 4 } } },
    { mutation: { $case: "stepRound", value: {} } },
    { mutation: { $case: "switchTurn", value: {} } },
    { mutation: { $case: "setWinner", value: { winner: 1 } } },
  ]));
  assert.equal(snapshot.phase, 4);
  assert.equal(snapshot.roundNumber, 3);
  assert.equal(snapshot.currentTurn, 1);
  assert.equal(snapshot.winner, 1);
  assert.equal(snapshot.warnings.length, 0);
});

test("does not count removal of a public combat status as a card discard", () => {
  const engine = new TrackerEngine({ catalog });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [], combatStatus: [{ id: -30, definitionId: 303202 }] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "removeEntity", value: {
    who: 0, where: 2, reason: 0, entity: { id: -30, definitionId: 303202 },
  } } }]));
  assert.equal(snapshot.cards.some((item) => item.definitionId === 303202), false);
  assert.equal(snapshot.events.some((event) => event.entityId === -30 && event.kind !== "frame"), false);
});

test("does not add public status creation to the card ledger", () => {
  const engine = new TrackerEngine({ catalog });
  const snapshot = engine.apply(frameFromNotification(1, 0, {
    phase: 3,
    player: [
      { handCard: [], pileCard: [], character: [], combatStatus: [{ id: -30, definitionId: 303202 }] },
      { handCard: [], pileCard: [], character: [] },
    ],
  }, [{ mutation: { $case: "createEntity", value: {
    who: 0, where: 2, entity: { id: -30, definitionId: 303202 },
  } } }]));
  assert.equal(snapshot.cards.some((row) => row.definitionId === 303202), false);
});

test("HTML adapter preserves visible identity and fails closed on hidden identity", () => {
  const engine = new TrackerEngine({ catalog });
  const first = frameFromHtml({
    sequence: 1,
    perspective: 0,
    phase: 3,
    roundNumber: 1,
    players: [
      {
        hand: [{ definitionId: 333001 }],
        pile: [],
        characters: [{ definitionId: 1411, health: 10, maxHealth: 10 }],
      },
      {
        hand: [{ known: false }],
        handCount: 1,
        pile: [],
        pileCount: 20,
        characters: [{ definitionId: 1510, health: 8, maxHealth: 10 }],
      },
    ],
  });
  const snapshot = engine.apply(first);
  assert.equal(snapshot.sides[0].knownHand[0]?.definitionId, 333001);
  assert.equal(snapshot.sides[1].knownHand.length, 0);
  assert.equal(snapshot.sides[1].handCount, 1);
  assert.equal(snapshot.sides[1].deckCount, 20);
  assert.equal(snapshot.cards.some((row) => row.side === 1 && row.definitionId !== 0), false);

  const malformedEngine = new TrackerEngine({ catalog });
  const malformed = malformedEngine.apply(frameFromHtml(null));
  assert.equal(malformed.sequence, 0);
  assert.match(malformed.warnings.join("\n"), /非法 frame perspective/);
  const duplicateIds = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      {
        hand: [{ entityId: -7, definitionId: 333001 }],
        pile: [{ entityId: -7, definitionId: 333001 }],
        characters: [],
      },
      { hand: [], pile: [], characters: [] },
    ],
  });
  const duplicateSnapshot = malformedEngine.apply(duplicateIds);
  assert.equal(duplicateSnapshot.sequence, 0);
  assert.match(duplicateSnapshot.warnings.join("\n"), /非法 frame perspective/);
  const malformedCard = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      { hand: [null as never], pile: [], characters: [] },
      { hand: [], pile: [], characters: [] },
    ],
  });
  const malformedCardSnapshot = malformedEngine.apply(malformedCard);
  assert.equal(malformedCardSnapshot.sequence, 0);
  const malformedEventSource = frameFromHtml({
    sequence: 1,
    perspective: 0,
    exposedMutations: null as never,
    players: [
      { hand: [], pile: [], characters: [] },
      { hand: [], pile: [], characters: [] },
    ],
  });
  const malformedEventSnapshot = malformedEngine.apply(malformedEventSource);
  assert.equal(malformedEventSnapshot.sequence, 0);
});

test("HTML adapter keeps hand and pile synthetic identities disjoint", () => {
  const engine = new TrackerEngine({ catalog, decks: [deck, undefined] });
  const snapshot = engine.apply(frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      {
        hand: [{ definitionId: 333001 }, { known: false }],
        pile: [{ definitionId: 333001 }, { known: false }],
        characters: [],
      },
      { hand: [], pile: [], characters: [] },
    ],
  }));
  assert.equal(snapshot.sides[0].handCount, 2);
  assert.equal(snapshot.sides[0].deckCount, 2);
  assert.deepEqual(snapshot.sides[0].knownHand.map((card) => card.definitionId), [333001]);
  const row = snapshot.cards.find((card) => card.side === 0 && card.definitionId === 333001);
  assert.equal(row?.handCount, 1);
  assert.equal(snapshot.warnings.length, 0);
});

test("HTML adapter rejects collisions between synthetic and explicit card identities", () => {
  const frame = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      {
        hand: [{ known: false }, { entityId: -800000, definitionId: 333001 }],
        pile: [],
        characters: [],
      },
      { hand: [], pile: [], characters: [] },
    ],
  });
  assert.equal(Number.isNaN(frame.sequence), true);
});

test("HTML adapter rejects unbounded visible zone counts before allocation", () => {
  const frame = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      { hand: [], handCount: 257, pile: [], characters: [] },
      { hand: [], pile: [], characters: [] },
    ],
  });
  assert.equal(Number.isNaN(frame.sequence), true);
});

test("HTML adapter bounds public entity recursion and exposed mutation volume", () => {
  let nested: Record<string, unknown> = { definitionId: 303202 };
  for (let index = 0; index < 9; index += 1) nested = { attachment: [nested] };
  const oversizedEntities = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      { hand: [], pile: [], characters: [], combatStatus: Array.from({ length: 257 }, () => ({ definitionId: 303202 })) },
      { hand: [], pile: [], characters: [] },
    ],
  });
  const deepEntities = frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      { hand: [], pile: [], characters: [], combatStatus: [nested] },
      { hand: [], pile: [], characters: [] },
    ],
  });
  const oversizedMutations = frameFromHtml({
    sequence: 1,
    perspective: 0,
    exposedMutations: Array.from({ length: 1025 }, () => ({})),
    players: [
      { hand: [], pile: [], characters: [] },
      { hand: [], pile: [], characters: [] },
    ],
  });
  assert.equal(Number.isNaN(oversizedEntities.sequence), true);
  assert.equal(Number.isNaN(deepEntities.sequence), true);
  assert.equal(Number.isNaN(oversizedMutations.sequence), true);
});

test("HTML adapter carries explicitly visible public entities, dice and flags", () => {
  const engine = new TrackerEngine({ catalog });
  const snapshot = engine.apply(frameFromHtml({
    sequence: 1,
    perspective: 0,
    players: [
      {
        hand: [],
        pile: [],
        characters: [],
        combatStatus: [{ entityId: -30, definitionId: 303202, variableName: "usages", variableValue: 2 }],
        summons: [{ definitionId: 0 }],
        supports: [{ entityId: -32, definitionId: 303202 }],
        dice: [1, "OMNI"],
        declaredEnd: true,
        legendUsed: false,
      },
      { hand: [], pile: [], characters: [] },
    ],
  }));
  assert.equal(snapshot.sides[0].combatStatus?.[0]?.name, "公开战斗状态");
  assert.equal(snapshot.sides[0].combatStatus?.[0]?.variableValue, 2);
  assert.equal(snapshot.sides[0].summons?.[0]?.name, undefined);
  assert.equal(snapshot.sides[0].supports?.[0]?.name, "公开战斗状态");
  assert.deepEqual(snapshot.sides[0].dice, [1, "OMNI"]);
  assert.equal(snapshot.sides[0].declaredEnd, true);
  assert.equal(snapshot.sides[0].legendUsed, false);
});
