import { readFile } from "node:fs/promises";
import type { DeckList } from "./types.ts";

const MAX_DECK_CHARACTERS = 16;
const MAX_DECK_CARDS = 256;

export function normalizeDeck(value: unknown): DeckList | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.characters) || !Array.isArray(raw.cards)) return undefined;
  if (raw.characters.length > MAX_DECK_CHARACTERS || raw.cards.length > MAX_DECK_CARDS) return undefined;
  const characters = raw.characters.filter((id): id is number => Number.isSafeInteger(id));
  const cards = raw.cards.filter((id): id is number => Number.isSafeInteger(id));
  if (characters.length !== raw.characters.length || cards.length !== raw.cards.length) return undefined;
  return { characters, cards };
}

export async function loadDeck(path: string): Promise<DeckList | undefined> {
  try {
    return normalizeDeck(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return undefined;
  }
}
