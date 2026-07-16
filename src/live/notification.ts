import { frameFromNotification, isValidNotificationState } from "../normalize.ts";
import type { Side, TrackerFrame } from "../types.ts";

export interface NotificationPayload {
  state?: unknown;
  mutation?: unknown[];
}

export class NotificationSequencer {
  private sequence = 0;
  private previousFingerprint = "";

  next(perspective: Side, notification: NotificationPayload): TrackerFrame | undefined {
    if (!isValidNotificationState(notification.state)) return undefined;
    const state = notification.state as Record<string, unknown>;
    const mutations = Array.isArray(notification.mutation) ? notification.mutation : [];
    const fingerprint = JSON.stringify({ state: notification.state, mutation: mutations });
    if (fingerprint === this.previousFingerprint) return undefined;
    this.previousFingerprint = fingerprint;
    this.sequence += 1;
    return frameFromNotification(this.sequence, perspective, notification.state, mutations);
  }
}

export class SseJsonParser {
  private pending = "";

  feed(chunk: string): unknown[] {
    this.pending += chunk;
    const blocks = this.pending.split(/\r?\n\r?\n/);
    this.pending = blocks.pop() ?? "";
    const result: unknown[] = [];
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        result.push(JSON.parse(data));
      } catch {
        // Ignore malformed or partial upstream events; the next reconnect can recover.
      }
    }
    return result;
  }

  flush(): unknown[] {
    const result = this.feed("\n\n");
    this.pending = "";
    return result;
  }
}
