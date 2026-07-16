/*
 * Read-only page bridge for the rain simulator room.
 * Run this in the simulator room page context (for example from a userscript or
 * an extension content-page bridge). It never clicks the board or submits an
 * action; it only mirrors the page's own public notification SSE to localhost.
 */
(() => {
  const previous = window.__GI_TCG_TRACKER_BRIDGE__;
  if (previous?.stop) previous.stop();

  const config = window.__GI_TCG_TRACKER_CONFIG__ || {};
  const pageStreamMode = window.__GI_TCG_TRACKER_PAGE_STREAM__ === true;
  const pageStreamChannel = window.__GI_TCG_TRACKER_PAGE_STREAM_CHANNEL__ || "";
  const localEndpoint = config.endpoint || "http://127.0.0.1:8787/api/ingest";
  const localSessionEndpoint = config.sessionEndpoint || "http://127.0.0.1:8787/api/session";
  const localStateEndpoint = config.stateEndpoint || "http://127.0.0.1:8787/api/state";
  const localTransportChannel = config.localTransportChannel || window.__GI_TCG_TRACKER_LOCAL_CHANNEL__;
  let localRequestSequence = 0;
  const roomMatch = location.pathname.match(/^\/rooms\/(\d+)(?:\/|$)/);
  const roomId = roomMatch ? Number.parseInt(roomMatch[1], 10) : NaN;
  const playerId = new URL(location.href).searchParams.get("player");
  if (!Number.isSafeInteger(roomId) || !playerId) {
    console.warn("gi-tcg-tracker: open a room URL with a player query first");
    return;
  }

  const apiBaseValue = config.apiBase || `${location.origin}/api/`;
  const apiBase = apiBaseValue.endsWith("/") ? apiBaseValue : `${apiBaseValue}/`;
  const controller = new AbortController();
  let stopped = false;
  let reconnectTimer = 0;
  let stateTimer = 0;
  let heartbeatTimer = 0;
  let pageStreamListener;
  let pageStreamTail = Promise.resolve();
  let directSseStarted = false;
  let heartbeatInFlight = false;
  let perspective;
  let overlay;
  let overlayBody;
  let sessionReady = false;
  let sessionRegistrationAttempted = false;
  let sessionRegistrationBlocked = false;
  let hasRenderedSnapshot = false;
  let localDeck;
  let opponentDeck;

  const phaseName = (value) => ({
    0: "初始手牌",
    1: "选择出战",
    2: "投掷骰子",
    3: "行动",
    4: "结束阶段",
    5: "对局结束",
    initHands: "初始手牌",
    initActives: "选择出战",
    roll: "投掷骰子",
    action: "行动",
    end: "结束阶段",
    gameEnd: "对局结束",
  }[value] || String(value ?? "未知阶段"));

  const createOverlay = () => {
    if (config.overlay === false || typeof document === "undefined" || !document.body) return;
    if (overlay && overlayBody && overlay.parentNode) return;
    const previousOverlay = document.getElementById("gi-tcg-tracker-overlay");
    previousOverlay?.remove();
    overlay = document.createElement("aside");
    overlay.id = "gi-tcg-tracker-overlay";
    overlay.setAttribute("aria-label", "雨酱牌记牌器");
    overlay.style.cssText = [
      "position:fixed", "top:12px", "right:12px", "z-index:2147483647",
      "width:300px", "max-width:calc(100vw - 24px)", "height:min(760px,calc(100vh - 24px))", "max-height:calc(100vh - 24px)", "overflow:hidden",
      "display:flex", "flex-direction:column", "min-height:0",
      "box-sizing:border-box", "padding:12px", "border:1px solid #59698f",
      "border-radius:10px", "background:rgba(18,23,36,.94)", "color:#eef1f7",
      "font:12px/1.45 system-ui,sans-serif", "box-shadow:0 8px 30px rgba(0,0,0,.35)",
      "pointer-events:none", "user-select:none",
    ].join(";");
    const title = document.createElement("div");
    title.textContent = "雨酱牌记牌器";
    title.style.cssText = "font-weight:700;font-size:14px;margin-bottom:5px";
    overlay.appendChild(title);
    overlayBody = document.createElement("div");
    overlayBody.tabIndex = 0;
    overlayBody.setAttribute("role", "region");
    overlayBody.setAttribute("aria-label", "记牌器内容，可滚动查看");
    overlayBody.style.cssText = [
      "flex:1 1 auto", "height:0", "min-height:0", "max-height:none", "overflow-y:scroll", "overflow-x:hidden",
      "overscroll-behavior:contain", "touch-action:pan-y", "pointer-events:auto",
      "user-select:text", "scrollbar-width:thin", "scrollbar-color:#7f8db4 transparent",
      "-webkit-overflow-scrolling:touch", "padding-right:4px", "box-sizing:border-box",
    ].join(";");
    overlayBody.addEventListener("wheel", (event) => {
      if (overlayBody.scrollHeight <= overlayBody.clientHeight) return;
      event.preventDefault();
      overlayBody.scrollTop += event.deltaY;
    }, { passive: false });
    overlay.appendChild(overlayBody);
    document.body.appendChild(overlay);
  };

  const setOverlayMessage = (message, color = "#b8c6e5") => {
    if (!overlayBody) return;
    overlayBody.replaceChildren();
    const node = document.createElement("div");
    node.textContent = message;
    node.style.color = color;
    overlayBody.appendChild(node);
  };

  const groupCards = (cards) => {
    const grouped = new Map();
    for (const card of cards || []) {
      const key = String(card.definitionId);
      const previous = grouped.get(key);
      if (previous) previous.count += 1;
      else grouped.set(key, { ...card, count: 1 });
    }
    return [...grouped.values()].sort((a, b) => Number(a.definitionId) - Number(b.definitionId));
  };
  const safeImageUrl = (value) => typeof value === "string"
    && /^https:\/\/static-data\.piovium\.org\/api\/v4\/image\/\d+\?thumbnail=(?:true|false)&type=cardFace$/.test(value)
    ? value
    : "";

  const renderCardSection = (title, cards, emptyText) => {
    const section = document.createElement("section");
    section.style.cssText = "padding:8px 0;border-top:1px solid #333d57";
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-weight:700;color:#d6def3;margin-bottom:7px";
    section.appendChild(heading);
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.textContent = emptyText;
      empty.style.color = "#8c98b4";
      section.appendChild(empty);
      overlayBody.appendChild(section);
      return;
    }
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px";
    for (const card of cards) {
      const tile = document.createElement("div");
      tile.style.cssText = "overflow:hidden;background:#202536;border:1px solid #3d4967;border-radius:6px";
      const imageUrl = safeImageUrl(card.imageUrl);
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = card.name || "未知牌";
        image.loading = "lazy";
        image.style.cssText = "display:block;width:100%;aspect-ratio:.72;object-fit:cover;background:#2b3144";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.textContent = card.name || "未知牌面";
        placeholder.style.cssText = "display:grid;place-items:center;width:100%;aspect-ratio:.72;padding:5px;box-sizing:border-box;color:#aeb6ca;text-align:center;font-size:10px";
        tile.appendChild(placeholder);
      }
      const info = document.createElement("div");
      info.style.cssText = "padding:5px;font-size:10px;line-height:1.3";
      const name = document.createElement("div");
      name.textContent = card.name || "未知牌";
      const count = document.createElement("div");
      count.textContent = card.countText || "";
      count.style.color = "#9eb8f1";
      info.append(name, count);
      tile.appendChild(info);
      grid.appendChild(tile);
    }
    section.appendChild(grid);
    overlayBody.appendChild(section);
  };

  const renderOverlay = (snapshot) => {
    if (!overlayBody) return;
    const preservedScrollTop = overlayBody.scrollTop;
    hasRenderedSnapshot = true;
    overlayBody.replaceChildren();
    const meta = document.createElement("div");
    meta.textContent = `#${snapshot.sequence ?? "?"} · 第${snapshot.roundNumber ?? "?"}回合 · ${phaseName(snapshot.phase)} · 视角 ${snapshot.perspective ?? "?"}`;
    meta.style.cssText = "color:#b8c6e5;margin-bottom:2px";
    overlayBody.appendChild(meta);
    const perspective = snapshot.perspective === 1 ? 1 : 0;
    const local = snapshot.sides?.[perspective] || {};
    const opponent = snapshot.sides?.[perspective === 1 ? 0 : 1] || {};
    const importedRows = (snapshot.cards || []).filter((card) => card.side === perspective && Number(card.remainingCount) > 0);
    const knownPile = groupCards(local.knownPile || []).map((card) => ({ ...card, countText: `当前可见 ${card.count} 张` }));
    const importedCards = importedRows.map((card) => ({ ...card, countText: `牌库剩余 ${card.remainingCount} 张` }));
    const importedIds = new Set(importedRows.map((card) => String(card.definitionId)));
    const dynamicPile = knownPile.filter((card) => !importedIds.has(String(card.definitionId)));
    const deckCards = [...importedCards, ...dynamicPile];
    const localPlayed = (snapshot.cards || []).filter((card) => card.side === perspective && Number(card.playedCount) > 0)
      .map((card) => ({ ...card, countText: `已打出 ${card.playedCount} 张` }));
    renderCardSection("我打出的牌", localPlayed, "还没有可确认的本方打出牌");
    renderCardSection("我牌库中的牌", deckCards, local.knownDeck ? "当前牌库没有可列出的剩余牌" : "未导入牌组，当前没有可确认的牌堆牌面");
    const opponentPlayed = (snapshot.cards || []).filter((card) => card.side !== perspective && Number(card.playedCount) > 0)
      .map((card) => ({ ...card, countText: `已打出 ${card.playedCount} 张` }));
    renderCardSection("对手打出的牌", opponentPlayed, "还没有可确认的对手打出牌");
    const opponentUnplayed = opponent.knownDeck
      ? (snapshot.cards || []).filter((card) => card.side !== perspective && Number(card.unplayedCount ?? Math.max(0, Number(card.deckCount) - Number(card.playedCount))) > 0)
        .map((card) => ({ ...card, countText: `尚未打出 ${card.unplayedCount ?? Math.max(0, Number(card.deckCount) - Number(card.playedCount))} 张` }))
      : [];
    renderCardSection("对手未打出的牌", opponentUnplayed, opponent.knownDeck ? "对手牌组中没有尚未打出的牌" : "对手完整牌组未知，真实视觉模式不可用");
    if (snapshot.warnings?.length) {
      const warning = document.createElement("div");
      warning.style.cssText = "padding-top:6px;color:#ffd28a";
      warning.textContent = `警告 ${snapshot.warnings.length} 条：${snapshot.warnings.at(-1)}`;
      overlayBody.appendChild(warning);
    }
    const restoreScrollTop = () => {
      if (!overlayBody) return;
      const maxScrollTop = Math.max(0, overlayBody.scrollHeight - overlayBody.clientHeight);
      overlayBody.scrollTop = Math.min(Math.max(0, preservedScrollTop), maxScrollTop);
    };
    restoreScrollTop();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreScrollTop);
  };

  const requestLocal = (url, init = {}) => {
    if (!localTransportChannel || typeof window.postMessage !== "function" || typeof window.addEventListener !== "function") {
      return fetch(url, init);
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const requestId = `${Date.now()}-${++localRequestSequence}`;
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        rejectPromise(new TypeError("local tracker transport timeout"));
      }, 15000);
      const onMessage = (event) => {
        const data = event?.data;
        if (!data || data.source !== "gi-tcg-tracker-userscript" || data.type !== "response"
          || data.channel !== localTransportChannel || data.requestId !== requestId) return;
        window.clearTimeout(timeoutId);
        window.removeEventListener("message", onMessage);
        if (data.error) {
          rejectPromise(new TypeError(String(data.error)));
          return;
        }
        const status = Number(data.status) || 0;
        const responseText = typeof data.responseText === "string" ? data.responseText : "";
        resolvePromise({
          ok: status >= 200 && status < 300,
          status,
          async json() { return JSON.parse(responseText); },
          async text() { return responseText; },
        });
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "gi-tcg-tracker-page",
        type: "request",
        channel: localTransportChannel,
        requestId,
        url,
        method: init.method || "GET",
        headers: init.headers || {},
        body: init.body,
      }, "*");
    });
  };

  const pollState = async () => {
    if (stopped || perspective === undefined || !sessionReady) return;
    try {
      const response = await requestLocal(`${localStateEndpoint}?perspective=${perspective}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`tracker state HTTP ${response.status}`);
      renderOverlay(await response.json());
    } catch (error) {
      if (!hasRenderedSnapshot) setOverlayMessage(`本地 tracker 不可用：${String(error)}`, "#ffd28a");
    }
  };

  const headers = { Accept: "text/event-stream" };
  const token = localStorage.getItem("accessToken");
  if (token) headers.Authorization = `Bearer ${token}`;
  const pageInstance = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sessionId = config.sessionId || `${location.origin}:${roomId}:${playerId}:${pageInstance}`;

  const announceSession = async () => {
    if (stopped || perspective === undefined || sessionRegistrationBlocked) return false;
    const replace = !sessionRegistrationAttempted;
    sessionRegistrationAttempted = true;
    try {
      const response = await requestLocal(localSessionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perspective, sessionId, replace, ...(localDeck ? { deck: localDeck } : {}), ...(opponentDeck ? { opponentDeck } : {}) }),
      });
      if (!response.ok) {
        const message = response.status === 409
          ? "本页 live session 已被另一个页面接管"
          : `tracker session HTTP ${response.status}`;
        throw new Error(message);
      }
      sessionReady = true;
      return true;
    } catch (error) {
      sessionReady = false;
      setOverlayMessage(`本地 tracker session 不可用：${String(error)}`, "#ffd28a");
      console.warn("gi-tcg-tracker: local session registration failed", String(error));
      if (String(error).includes("本页 live session 已被另一个页面接管")) {
        sessionRegistrationBlocked = true;
        controller.abort();
      }
      return false;
    }
  };

  const heartbeatSession = async () => {
    if (stopped || perspective === undefined || sessionRegistrationBlocked || !sessionReady || heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      const response = await requestLocal(localSessionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perspective, sessionId, heartbeat: true }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          const details = await response.json().catch(() => ({}));
          if (details?.reason === "live-session-expired") {
            sessionReady = false;
            await announceSession();
            return;
          }
          sessionRegistrationBlocked = true;
          setOverlayMessage("本页 live session 已被另一个页面接管", "#ffd28a");
          controller.abort();
          return;
        }
        throw new Error(`tracker heartbeat HTTP ${response.status}`);
      }
      sessionReady = true;
    } catch (error) {
      sessionReady = false;
      if (!hasRenderedSnapshot) setOverlayMessage(`本地 tracker session 不可用：${String(error)}`, "#ffd28a");
      console.warn("gi-tcg-tracker: local session heartbeat failed", String(error));
    } finally {
      heartbeatInFlight = false;
    }
  };

  const startHeartbeat = () => {
    if (!heartbeatTimer) heartbeatTimer = window.setInterval(() => void heartbeatSession(), 5000);
  };

  const waitForSession = async () => {
    while (!stopped && !sessionRegistrationBlocked) {
      if (await announceSession()) return true;
      await new Promise((resolvePromise) => window.setTimeout(resolvePromise, 1000));
    }
    return false;
  };

  const parseBlocks = (text) => {
    const blocks = text.split(/\r?\n\r?\n/);
    const tail = blocks.pop() || "";
    const payloads = [];
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try { payloads.push(JSON.parse(data)); } catch {}
    }
    return { payloads, tail };
  };

  const forward = async (payload) => {
    if (payload?.type === "initialized") {
      perspective = payload.who === 1 ? 1 : payload.who === 0 ? 0 : undefined;
      localDeck = payload.myPlayerInfo?.deck;
      opponentDeck = payload.oppPlayerInfo?.deck;
      if (perspective !== undefined) {
        createOverlay();
        if (await waitForSession()) {
          startHeartbeat();
          void pollState();
        }
      }
      return;
    }
    if (payload?.type !== "notification" || perspective === undefined || !sessionReady) return;
    const response = await requestLocal(localEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        perspective,
        sessionId,
        notification: payload.data,
      }),
    });
    if (response.ok) {
      sessionReady = true;
      return;
    }
    sessionReady = false;
    if (response.status === 409) {
      sessionRegistrationBlocked = true;
      setOverlayMessage("本页 live session 已被另一个页面接管", "#ffd28a");
      controller.abort();
    }
    console.warn("gi-tcg-tracker: local ingest rejected", response.status);
  };

  const enqueuePageStreamPayload = (payload) => {
    pageStreamTail = pageStreamTail
      .then(() => forward(payload))
      .catch((error) => {
        if (!hasRenderedSnapshot) setOverlayMessage(`页面通知流处理失败：${String(error)}`, "#ffd28a");
        console.warn("gi-tcg-tracker: page notification stream processing failed", String(error));
      });
  };

  const startDirectSse = () => {
    if (directSseStarted || stopped) return;
    directSseStarted = true;
    void connect();
  };

  const startPageStream = () => {
    if (!pageStreamMode || window.__GI_TCG_TRACKER_PAGE_STREAM_INSTALLED__ !== true
      || !pageStreamChannel || typeof window.addEventListener !== "function") return false;
    const handlePageStreamPayload = (payload) => {
      if (payload?.type === "tapUnavailable") {
        setOverlayMessage("页面通知流不支持复制，切换到独立 SSE…", "#ffd28a");
        startDirectSse();
        return;
      }
      if (payload?.type === "tapError") {
        setOverlayMessage(`页面通知流错误：${String(payload.error || "未知错误")}`, "#ffd28a");
        startDirectSse();
        return;
      }
      enqueuePageStreamPayload(payload);
    };
    pageStreamListener = (event) => {
      const message = event?.data;
      if (!message || message.source !== "gi-tcg-tracker-page-stream"
        || message.type !== "payload" || message.channel !== pageStreamChannel) return;
      handlePageStreamPayload(message.payload);
    };
    window.addEventListener("message", pageStreamListener);
    const queued = window.__GI_TCG_TRACKER_PAGE_STREAM_QUEUE__;
    if (Array.isArray(queued)) {
      for (const payload of queued.splice(0)) handlePageStreamPayload(payload);
    }
    setOverlayMessage("正在复用页面 notification 流…");
    return true;
  };

  const connect = async () => {
    if (stopped) return;
    if (!hasRenderedSnapshot) setOverlayMessage("正在连接雨酱房间 SSE…");
    const url = new URL(`rooms/${roomId}/players/${encodeURIComponent(playerId)}/notification`, apiBase);
    try {
      const response = await fetch(url, { headers, credentials: "include", signal: controller.signal });
      if (response.status === 404) {
        stopped = true;
        sessionRegistrationBlocked = true;
        window.clearTimeout(reconnectTimer);
        setOverlayMessage("房间不存在或当前玩家已离开，已停止重试", "#ffd28a");
        console.warn("gi-tcg-tracker: room notification stream returned 404; retry stopped");
        return;
      }
      if (!response.ok || !response.body) throw new Error(`notification stream HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (!stopped) {
        const next = await reader.read();
        if (next.done) break;
        const parsed = parseBlocks(pending + decoder.decode(next.value, { stream: true }));
        pending = parsed.tail;
        for (const payload of parsed.payloads) await forward(payload);
      }
      const flushed = parseBlocks(`${pending + decoder.decode()}\n\n`);
      for (const payload of flushed.payloads) await forward(payload);
    } catch (error) {
      if (!stopped) {
        if (!hasRenderedSnapshot) setOverlayMessage(`SSE 连接失败，正在重试：${String(error)}`, "#ffd28a");
        console.warn("gi-tcg-tracker: notification stream reconnecting", String(error));
      }
    }
    if (!stopped && !sessionRegistrationBlocked) {
      if (!hasRenderedSnapshot) setOverlayMessage("SSE 已断开，1 秒后重试…", "#ffd28a");
      reconnectTimer = window.setTimeout(connect, 1000);
    }
  };

  window.__GI_TCG_TRACKER_BRIDGE__ = {
    stop() {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(stateTimer);
      window.clearInterval(heartbeatTimer);
      controller.abort();
      overlay?.remove();
      if (pageStreamListener && typeof window.removeEventListener === "function") {
        window.removeEventListener("message", pageStreamListener);
      }
    },
  };
  createOverlay();
  setOverlayMessage("正在等待雨酱房间通知…");
  stateTimer = window.setInterval(() => void pollState(), 1500);
  if (!startPageStream()) startDirectSse();
  console.info("gi-tcg-tracker: read-only room notification bridge started", { roomId, playerId });
})();
