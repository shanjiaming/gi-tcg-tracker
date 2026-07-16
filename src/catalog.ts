import { readFile } from "node:fs/promises";
import type { CardCatalogEntry } from "./types.ts";

export type Catalog = Map<number, CardCatalogEntry>;

export const DEFAULT_CARD_IMAGE_API = "https://static-data.piovium.org/api/v4";

export function catalogFromObject(value: unknown): Catalog {
  const result: Catalog = new Map();
  const entries = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).cards
    : undefined;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return result;
  for (const [key, raw] of Object.entries(entries)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const id = Number(entry.id ?? key);
    const name = typeof entry.name === "string" ? entry.name : `#${id}`;
    const kind = entry.kind;
    if (!Number.isSafeInteger(id)) continue;
    result.set(id, {
      id,
      name,
      kind: kind === "card" || kind === "character" || kind === "skill" || kind === "entity"
        ? kind
        : "unknown",
      ...(typeof entry.imageUrl === "string" ? { imageUrl: entry.imageUrl } : {}),
    });
  }
  return result;
}

export async function loadCatalog(path: string): Promise<Catalog> {
  try {
    return catalogFromObject(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return new Map();
  }
}

export function nameOf(catalog: Catalog, definitionId: number | undefined): string {
  if (!Number.isSafeInteger(definitionId) || definitionId === 0) return "未知牌";
  const id = definitionId as number;
  return catalog.get(id)?.name ?? `#${id}`;
}

export function imageUrlOf(catalog: Catalog, definitionId: number | undefined): string | undefined {
  if (!Number.isSafeInteger(definitionId) || definitionId === 0) return undefined;
  const entry = catalog.get(definitionId as number);
  if (entry?.imageUrl) return entry.imageUrl;
  if (entry && entry.kind !== "card") return undefined;
  return `${DEFAULT_CARD_IMAGE_API}/image/${definitionId}?thumbnail=true&type=cardFace`;
}
