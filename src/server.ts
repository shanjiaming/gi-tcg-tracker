import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCatalog } from "./catalog.ts";
import { loadDeck, normalizeDeck } from "./decks.ts";
import { TrackerEngine } from "./engine.ts";
import { NotificationSequencer, type NotificationPayload } from "./live/notification.ts";
import { loadTrace } from "./trace.ts";
import type { DeckList, Side, TrackerSnapshot } from "./types.ts";

export function resolveReplayTracePath(
  tracePath: string,
  perspective: Side,
  explicitPerspectiveOnePath?: string,
): string | undefined {
  if (perspective === 1 && explicitPerspectiveOnePath) return resolve(explicitPerspectiveOnePath);
  const match = tracePath.match(/^(.*)-p[01](\.jsonl)$/);
  if (match) return `${match[1]}-p${perspective}${match[2]}`;
  return perspective === 0 ? tracePath : undefined;
}

export type LiveSessionAction = "activate" | "accept" | "replace" | "reject";

export const DEFAULT_LIVE_SESSION_TIMEOUT_MS = 15_000;

export function resolveLiveSessionTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_LIVE_SESSION_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1_000 ? value : DEFAULT_LIVE_SESSION_TIMEOUT_MS;
}

export function isLiveSessionFresh(
  lastSeenAt: number,
  now = Date.now(),
  timeoutMs = DEFAULT_LIVE_SESSION_TIMEOUT_MS,
): boolean {
  return Number.isFinite(lastSeenAt) && now >= lastSeenAt && now - lastSeenAt <= timeoutMs;
}

export function cacheBySide<T>(loader: (perspective: Side) => Promise<T>): (perspective: Side) => Promise<T> {
  const cache = new Map<Side, Promise<T>>();
  return (perspective) => {
    const cached = cache.get(perspective);
    if (cached) return cached;
    const pending = loader(perspective);
    cache.set(perspective, pending);
    return pending;
  };
}

export function decideLiveSession(
  currentSessionId: string | undefined,
  incomingSessionId: string,
  allowReplace: boolean,
): LiveSessionAction {
  if (currentSessionId === undefined) return "activate";
  if (currentSessionId === incomingSessionId) return "accept";
  return allowReplace ? "replace" : "reject";
}

export const DASHBOARD = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>雨酱牌记牌器</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#11131b; color:#eef1f7; }
body { margin:0; min-width:760px; background: radial-gradient(circle at 15% 0%, #26304b 0, #11131b 42rem); }
header { padding:24px 32px 18px; border-bottom:1px solid #34394c; display:flex; justify-content:space-between; align-items:end; }
h1 { margin:0; letter-spacing:.03em; font-size:24px; } .sub { color:#aeb6ca; margin-top:5px; font-size:12px; }
main { padding:24px 32px 48px; max-width:1500px; margin:auto; }
.meta { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; }.pill { background:#202638; border:1px solid #3a4562; border-radius:999px; padding:7px 12px; color:#cbd5ef; font-size:12px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }.panel { background:rgba(25,29,42,.88); border:1px solid #353b51; border-radius:14px; padding:18px; box-shadow:0 15px 40px #090b12aa; }
.panel h2 { margin:0 0 8px; font-size:16px; }.panel-note { color:#aeb6ca; font-size:12px; min-height:18px; margin-bottom:12px; }
.card-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(128px,1fr)); gap:12px; }.card-tile { overflow:hidden; background:#202536; border:1px solid #3d4967; border-radius:10px; box-shadow:0 8px 20px #090b1266; }.card-tile img,.card-placeholder { display:block; width:100%; aspect-ratio:0.72; object-fit:cover; background:#2b3144; }.card-placeholder { display:grid; place-items:center; padding:10px; box-sizing:border-box; color:#aeb6ca; text-align:center; font-size:12px; }.card-info { padding:8px; }.card-name { min-height:32px; font-size:12px; line-height:1.35; }.card-count { color:#9eb8f1; font-size:11px; margin-top:5px; }.muted { color:#7f8aa5; }.warning { color:#ffd28a; background:#3a2f1d; border:1px solid #76582d; padding:8px 10px; border-radius:8px; margin-bottom:8px; font-size:12px; }.empty { color:#78839f; font-size:12px; padding:12px 0; }
</style>
</head>
<body><header><div><h1>雨酱牌记牌器</h1><div class="sub">我方已打出 · 我方牌库 · 对手已打出 · 对手未打出</div></div><div class="sub" id="refresh">loading</div></header><main><div class="meta" id="meta"></div><div id="warnings"></div><div class="grid"><section class="panel"><h2>我打出的牌</h2><div class="panel-note" id="local-played-note"></div><div class="card-list" id="local-played"></div></section><section class="panel"><h2>我牌库中的牌</h2><div class="panel-note" id="local-deck-note"></div><div class="card-list" id="local-deck"></div></section><section class="panel"><h2>对手打出的牌</h2><div class="panel-note" id="opponent-played-note"></div><div class="card-list" id="opponent-played"></div></section><section class="panel"><h2>对手未打出的牌</h2><div class="panel-note" id="opponent-unplayed-note"></div><div class="card-list" id="opponent-unplayed"></div></section></div></main>
<script>
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phase = (v) => ({0:'初始手牌',1:'选择出战',2:'投掷骰子',3:'行动',4:'结束阶段',5:'对局结束','initHands':'初始手牌','initActives':'选择出战','roll':'投掷骰子','action':'行动','end':'结束阶段','gameEnd':'对局结束'}[v] ?? v ?? '未知');
const grouped = (cards) => {
  const result = new Map();
  (cards || []).forEach((card) => {
    const key = String(card.definitionId);
    const previous = result.get(key);
    if (previous) previous.count += 1;
    else result.set(key, { ...card, count: 1 });
  });
  return [...result.values()].sort((a, b) => Number(a.definitionId) - Number(b.definitionId));
};
const safeImageUrl = (value) => typeof value === 'string' && /^https:\\/\\/static-data\\.piovium\\.org\\/api\\/v4\\/image\\/\\d+\\?thumbnail=(?:true|false)&type=cardFace$/.test(value) ? value : '';
const tile = (card, countText) => {
  const imageUrl = safeImageUrl(card.imageUrl);
  const image = imageUrl
    ? '<img src="' + esc(imageUrl) + '" alt="' + esc(card.name) + '" loading="lazy">'
    : '<div class="card-placeholder">' + esc(card.name || '未知牌面') + '</div>';
  return '<article class="card-tile">' + image + '<div class="card-info"><div class="card-name">' + esc(card.name || '未知牌') + '</div><div class="card-count">' + esc(countText) + '</div></div></article>';
};
const renderList = (id, cards, emptyText) => {
  document.getElementById(id).innerHTML = cards.length ? cards.map((card) => tile(card, card.countText)).join('') : '<div class="empty">' + esc(emptyText) + '</div>';
};
const numericCount = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const render = (d) => {
  const perspective = d.perspective === 1 ? 1 : 0;
  const local = d.sides?.[perspective] || {};
  const opponent = d.sides?.[perspective === 1 ? 0 : 1] || {};
  const meta = ["frame " + d.sequence, "第 " + String(d.roundNumber ?? "?") + " 回合", "阶段 " + esc(phase(d.phase)), "视角玩家 " + perspective];
  document.getElementById("meta").innerHTML = meta.map((x) => '<span class="pill">' + x + '</span>').join('');
  document.getElementById("warnings").innerHTML = (d.warnings || []).map((w) => '<div class="warning">' + esc(w) + '</div>').join('');
  const importedRows = (d.cards || []).filter((card) => card.side === perspective && Number(card.remainingCount) > 0);
  const knownPile = grouped(local.knownPile || []).map((card) => ({ ...card, countText: "当前可见 " + card.count + " 张" }));
  const importedCards = importedRows.map((card) => ({ ...card, countText: "牌库剩余 " + String(card.remainingCount) + " 张" }));
  const importedIds = new Set(importedRows.map((card) => String(card.definitionId)));
  const dynamicPile = knownPile.filter((card) => !importedIds.has(String(card.definitionId)));
  const deckCards = [...importedCards, ...dynamicPile];
  const localPlayed = (d.cards || []).filter((card) => card.side === perspective && Number(card.playedCount) > 0)
    .map((card) => ({ ...card, countText: "已打出 " + String(card.playedCount) + " 张" }));
  document.getElementById("local-deck-note").textContent = importedRows.length
    ? "按已导入牌组计算当前剩余数量"
    : "仅显示当前能确认身份的牌堆牌面，其余保持未知";
  renderList("local-deck", deckCards, local.knownDeck ? "当前牌库没有可列出的剩余牌" : "未导入牌组，当前没有可确认的牌堆牌面");
  document.getElementById("local-played-note").textContent = localPlayed.length ? "仅统计已经确认打出的本方卡牌" : "还没有可确认的本方打出牌";
  renderList("local-played", localPlayed, "还没有可确认的本方打出牌");
  const opponentPlayed = (d.cards || []).filter((card) => card.side !== perspective && Number(card.playedCount) > 0)
    .map((card) => ({ ...card, countText: "已打出 " + String(card.playedCount) + " 张" }));
  document.getElementById("opponent-played-note").textContent = opponentPlayed.length ? "仅统计已经公开确认打出的牌" : "还没有可确认的对手打出牌";
  renderList("opponent-played", opponentPlayed, "还没有可确认的对手打出牌");
  const opponentUnplayed = opponent.knownDeck
    ? (d.cards || []).filter((card) => card.side !== perspective && (numericCount(card.unplayedCount) ?? Math.max(0, Number(card.deckCount) - Number(card.playedCount))) > 0)
      .map((card) => ({ ...card, countText: "尚未打出 " + String(numericCount(card.unplayedCount) ?? Math.max(0, Number(card.deckCount) - Number(card.playedCount))) + " 张" }))
    : [];
  document.getElementById("opponent-unplayed-note").textContent = opponent.knownDeck
    ? "模拟器完整对手牌组减去已经确认打出的牌"
    : "当前信息源没有提供对手完整牌组；真实视觉模式不可用";
  renderList("opponent-unplayed", opponentUnplayed, opponent.knownDeck ? "对手牌组中没有尚未打出的牌" : "对手完整牌组未知，无法列出");
  document.getElementById("refresh").textContent = "updated " + new Date().toLocaleTimeString();
};
async function tick(){ try { const r=await fetch('/api/state',{cache:'no-store'}); render(await r.json()); } catch(e) { document.getElementById('refresh').textContent='error'; } } tick(); setInterval(tick,1000);
</script></body></html>`;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 8 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startServer(options: { host: string; port: number }): Promise<Server> {
  const tracePath = resolve(process.env.TRACKER_TRACE ?? "records/simulator/game-20260715-p0.jsonl");
  const catalogPath = resolve(process.env.TRACKER_CATALOG ?? "data/catalog.json");
  const catalog = await loadCatalog(catalogPath);
  const collectorScript = await readFile(resolve("scripts/room-sse-collector.js"), "utf8").catch(() => "");
  const deckA = await loadDeck(resolve(process.env.TRACKER_DECK0 ?? "harness/decks/standard-a.json"));
  const deckB = await loadDeck(resolve(process.env.TRACKER_DECK1 ?? "harness/decks/standard-b.json"));
  const liveDeck0 = process.env.TRACKER_LIVE_DECK0 ? await loadDeck(resolve(process.env.TRACKER_LIVE_DECK0)) : undefined;
  const liveDeck1 = process.env.TRACKER_LIVE_DECK1 ? await loadDeck(resolve(process.env.TRACKER_LIVE_DECK1)) : undefined;
  const replayDecks: [DeckList | undefined, DeckList | undefined] = [deckA, deckB];
  const liveDecks: [DeckList | undefined, DeckList | undefined] = [liveDeck0, liveDeck1];
  const liveEngines = new Map<Side, TrackerEngine>();
  const liveSequencers = new Map<Side, NotificationSequencer>();
  const liveSnapshots = new Map<Side, TrackerSnapshot>();
  const liveSessionIds = new Map<Side, string>();
  const liveSessionLastSeenAt = new Map<Side, number>();
  const liveSessionTimeoutMs = resolveLiveSessionTimeoutMs(process.env.TRACKER_LIVE_SESSION_TIMEOUT_MS);
  const liveDeckOverrides = new Map<Side, { own?: DeckList; opponent?: DeckList }>();
  const touchLiveSession = (perspective: Side, sessionId: string): void => {
    if (liveSessionIds.get(perspective) === sessionId) liveSessionLastSeenAt.set(perspective, Date.now());
  };
  const deactivateLiveSession = (perspective: Side): void => {
    liveSessionIds.delete(perspective);
    liveSessionLastSeenAt.delete(perspective);
    liveEngines.delete(perspective);
    liveSequencers.delete(perspective);
    liveSnapshots.delete(perspective);
    liveDeckOverrides.delete(perspective);
  };
  const pruneStaleLiveSessions = (): void => {
    const now = Date.now();
    for (const [perspective, lastSeenAt] of liveSessionLastSeenAt) {
      if (!isLiveSessionFresh(lastSeenAt, now, liveSessionTimeoutMs)) deactivateLiveSession(perspective);
    }
  };
  const activateLiveSession = (perspective: Side, sessionId: string, deck?: DeckList, opponentDeck?: DeckList): boolean => {
    const previousSessionId = liveSessionIds.get(perspective);
    const reset = previousSessionId !== undefined && previousSessionId !== sessionId;
    if (reset) {
      liveEngines.delete(perspective);
      liveSequencers.delete(perspective);
      liveSnapshots.delete(perspective);
    }
    if (deck || opponentDeck) liveDeckOverrides.set(perspective, {
      ...(deck ? { own: deck } : {}),
      ...(opponentDeck ? { opponent: opponentDeck } : {}),
    });
    else if (reset) liveDeckOverrides.delete(perspective);
    liveSessionIds.set(perspective, sessionId);
    liveSessionLastSeenAt.set(perspective, Date.now());
    return reset;
  };
  const liveDecksFor = (perspective: Side): [DeckList | undefined, DeckList | undefined] => {
    const decks: [DeckList | undefined, DeckList | undefined] = [...liveDecks];
    const override = liveDeckOverrides.get(perspective);
    if (override?.own) decks[perspective] = override.own;
    if (override?.opponent) decks[perspective === 1 ? 0 : 1] = override.opponent;
    return decks;
  };
  const emptySnapshot = (perspective: Side, warning: string, decks: [DeckList | undefined, DeckList | undefined]): TrackerSnapshot => {
    const engine = new TrackerEngine({ catalog, decks });
    return { ...engine.snapshot(), perspective, warnings: [warning] };
  };
  const loadReplaySnapshot = async (perspective: Side): Promise<TrackerSnapshot> => {
    const replayPath = resolveReplayTracePath(tracePath, perspective, process.env.TRACKER_TRACE_P1);
    if (!replayPath) {
      return emptySnapshot(perspective, `没有玩家 ${perspective} 的 live 或 replay snapshot`, replayDecks);
    }
    try {
      return { ...(await loadTrace(replayPath, { catalog, decks: replayDecks })), perspective };
    } catch (error) {
      return emptySnapshot(perspective, `玩家 ${perspective} 的 replay 不可用：${String(error)}`, replayDecks);
    }
  };
  const getReplaySnapshot = cacheBySide(loadReplaySnapshot);
  const getLiveEngine = (perspective: Side): TrackerEngine => {
    let engine = liveEngines.get(perspective);
    if (!engine) {
      engine = new TrackerEngine({ catalog, decks: liveDecksFor(perspective) });
      liveEngines.set(perspective, engine);
    }
    return engine;
  };
  const getLiveSequencer = (perspective: Side): NotificationSequencer => {
    let sequencer = liveSequencers.get(perspective);
    if (!sequencer) {
      sequencer = new NotificationSequencer();
      liveSequencers.set(perspective, sequencer);
    }
    return sequencer;
  };
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    pruneStaleLiveSessions();
    const url = new URL(request.url ?? "/", "http://gi-tcg-tracker.local");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-origin": "*",
        "access-control-allow-private-network": "true",
      });
      response.end();
      return;
    }
    if (url.pathname === "/bridge/room-sse-collector.js" && request.method === "GET") {
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      });
      response.end(collectorScript);
      return;
    }
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(DASHBOARD);
      return;
    }
    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        project: "gi-tcg-tracker",
        trace: tracePath,
        livePerspectives: [...liveSnapshots.keys()],
        liveSessions: Object.fromEntries([...liveSessionIds].map(([who, id]) => [who, id])),
      });
      return;
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      try {
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        const perspective = body.perspective === 1 ? 1 : body.perspective === 0 ? 0 : undefined;
        const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0 ? body.sessionId : undefined;
        const deck = body.deck === undefined ? undefined : normalizeDeck(body.deck);
        const opponentDeck = body.opponentDeck === undefined ? undefined : normalizeDeck(body.opponentDeck);
        if (perspective === undefined || !sessionId) {
          sendJson(response, 400, { ok: false, error: "expected perspective and sessionId" });
          return;
        }
        if (body.deck !== undefined && !deck) {
          sendJson(response, 400, { ok: false, error: "expected a valid deck with integer characters and cards" });
          return;
        }
        if (body.opponentDeck !== undefined && !opponentDeck) {
          sendJson(response, 400, { ok: false, error: "expected a valid opponentDeck with integer characters and cards" });
          return;
        }
        if (body.heartbeat === true) {
          if (liveSessionIds.get(perspective) !== sessionId) {
            sendJson(response, 409, {
              ok: false,
              reason: liveSessionIds.has(perspective) ? "stale-live-session" : "live-session-expired",
              perspective,
              sessionId,
            });
            return;
          }
          touchLiveSession(perspective, sessionId);
          sendJson(response, 200, { ok: true, perspective, sessionId, action: "heartbeat" });
          return;
        }
        const action = decideLiveSession(liveSessionIds.get(perspective), sessionId, body.replace === true);
        if (action === "reject") {
          sendJson(response, 409, { ok: false, reason: "stale-live-session", perspective, sessionId });
          return;
        }
        const reset = action === "replace"
          ? activateLiveSession(perspective, sessionId, deck, opponentDeck)
          : action === "activate"
            ? activateLiveSession(perspective, sessionId, deck, opponentDeck)
            : false;
        if (action === "accept") touchLiveSession(perspective, sessionId);
        const override = liveDeckOverrides.get(perspective);
        sendJson(response, 200, {
          ok: true,
          perspective,
          sessionId,
          reset,
          action,
          liveDeck: override?.own !== undefined,
          liveOpponentDeck: override?.opponent !== undefined,
        });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error) });
      }
      return;
    }
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      try {
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        const perspective = body.perspective === 1 ? 1 : body.perspective === 0 ? 0 : undefined;
        const notification = (body.notification ?? body) as NotificationPayload;
        const sessionId = typeof body.sessionId === "string" && body.sessionId.length > 0 ? body.sessionId : "default";
        if (perspective === undefined || !notification || notification.state === undefined) {
          sendJson(response, 400, { ok: false, error: "expected perspective and notification.state" });
          return;
        }
        const sessionAction = decideLiveSession(liveSessionIds.get(perspective), sessionId, false);
        if (sessionAction === "reject") {
          sendJson(response, 409, { ok: false, accepted: false, reason: "stale-live-session", sessionId });
          return;
        }
        if (sessionAction === "activate") activateLiveSession(perspective, sessionId);
        else touchLiveSession(perspective, sessionId);
        const frame = getLiveSequencer(perspective).next(perspective, notification);
        if (!frame) {
          sendJson(response, 200, { ok: true, accepted: false, reason: "duplicate-or-empty-notification", sessionId });
          return;
        }
        const snapshot = getLiveEngine(perspective).apply(frame);
        liveSnapshots.set(perspective, snapshot);
        sendJson(response, 200, { ok: true, accepted: true, sequence: snapshot.sequence, sessionId, warnings: snapshot.warnings });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error) });
      }
      return;
    }
    if (url.pathname === "/api/state") {
      const requestedPerspective = url.searchParams.get("perspective") === "1" ? 1 : 0;
      const live = liveSnapshots.get(requestedPerspective);
      if (live) {
        sendJson(response, 200, live);
      } else if (liveSessionIds.has(requestedPerspective)) {
        sendJson(response, 200, emptySnapshot(requestedPerspective, `玩家 ${requestedPerspective} 等待 live 首帧`, liveDecksFor(requestedPerspective)));
      } else {
        sendJson(response, 200, await getReplaySnapshot(requestedPerspective));
      }
      return;
    }
    sendJson(response, 404, { error: "not found" });
  });
  await new Promise<void>((resolvePromise) => server.listen(options.port, options.host, resolvePromise));
  return server;
}
