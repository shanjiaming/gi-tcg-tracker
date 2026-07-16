import { readFile } from "node:fs/promises";
import type { Catalog } from "./catalog.ts";
import { TrackerEngine } from "./engine.ts";
import { frameFromNotification } from "./normalize.ts";
import type { DeckList, TrackerSnapshot } from "./types.ts";

export interface TraceLoadOptions {
  catalog?: Catalog;
  decks?: [DeckList | undefined, DeckList | undefined];
}

export async function loadTrace(path: string, options: TraceLoadOptions = {}): Promise<TrackerSnapshot> {
  const engine = new TrackerEngine(options);
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean);
  let perspective: 0 | 1 = 0;
  for (const [index, line] of lines.entries()) {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.kind === "session" && (record.perspective === 0 || record.perspective === 1)) {
      perspective = record.perspective;
      continue;
    }
    if (record.kind !== "notification" && record.kind !== "frame") continue;
    const sequence = Number(record.sequence ?? index + 1);
    const state = record.state ?? (record.notification && (record.notification as Record<string, unknown>).state);
    const mutations = Array.isArray(record.mutations)
      ? record.mutations
      : Array.isArray(record.mutation)
        ? record.mutation
        : Array.isArray((record.notification as Record<string, unknown> | undefined)?.mutation)
          ? (record.notification as Record<string, unknown>).mutation as unknown[]
          : [];
    if (!Number.isSafeInteger(sequence) || !state) continue;
    engine.apply(frameFromNotification(sequence, perspective, state, mutations));
  }
  return engine.snapshot();
}
