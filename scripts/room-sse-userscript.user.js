// ==UserScript==
// @name         GI-TCG Tracker room bridge
// @namespace    gi-tcg-tracker
// @version      0.3.0
// @description  Read-only notification collector for a Rain-jiang simulator room.
// @match        https://amechan.7shengzhaohuan.online/rooms/*
// @match        http://amechan.7shengzhaohuan.online/rooms/*
// @match        https://beta.amechan.7shengzhaohuan.online/rooms/*
// @match        http://beta.amechan.7shengzhaohuan.online/rooms/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(() => {
  const channel = `gi-tcg-tracker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const isRainRoom = /^(?:amechan|beta\.amechan)\.7shengzhaohuan\.online$/.test(location.hostname);
  const postResponse = (request, response, error) => {
    window.postMessage({
      source: "gi-tcg-tracker-userscript",
      type: "response",
      channel,
      requestId: request.requestId,
      status: response?.status ?? 0,
      responseText: response?.responseText ?? "",
      error: error ? String(error) : undefined,
    }, "*");
  };
  window.addEventListener("message", (event) => {
    const request = event.data;
    if (!request || request.source !== "gi-tcg-tracker-page" || request.type !== "request" || request.channel !== channel) return;
    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== "http://127.0.0.1:8787" || !requestUrl.pathname.startsWith("/api/")) {
      postResponse(request, undefined, "blocked non-local tracker request");
      return;
    }
    GM_xmlhttpRequest({
      method: request.method || "GET",
      url: request.url,
      headers: request.headers || {},
      data: request.body,
      onload: (response) => postResponse(request, response),
      onerror: (error) => postResponse(request, undefined, error || "local tracker request failed"),
      ontimeout: () => postResponse(request, undefined, "local tracker request timed out"),
    });
  });
  // The Rain page already owns one authenticated notification fetch. Tee that
  // response in page context so the tracker observes the exact stream the UI
  // uses, without opening a competing room SSE connection. The collector
  // drains the bounded queue below if it is injected after the first event.
  const pageTap = document.createElement("script");
  pageTap.dataset.giTcgTracker = "page-stream-tap";
  pageTap.textContent = `(() => {
    const channel = ${JSON.stringify(channel)};
    const installedKey = "__GI_TCG_TRACKER_PAGE_STREAM_INSTALLED__";
    const queueKey = "__GI_TCG_TRACKER_PAGE_STREAM_QUEUE__";
    if (window[installedKey]) return;
    window[installedKey] = true;
    const queue = window[queueKey] || (window[queueKey] = []);
    const emit = (payload) => {
      if (payload?.type === "initialized") {
        const previous = queue.findIndex((item) => item?.type === "initialized");
        if (previous >= 0) queue.splice(previous, 1);
      }
      if (queue.length >= 256) {
        const dropIndex = queue.findIndex((item) => item?.type !== "initialized");
        queue.splice(dropIndex >= 0 ? dropIndex : 0, 1);
      }
      queue.push(payload);
      window.postMessage({ source: "gi-tcg-tracker-page-stream", type: "payload", channel, payload }, "*");
    };
    const parse = (state, chunk) => {
      state.pending += chunk;
      const blocks = state.pending.split(/\\r?\\n\\r?\\n/);
      state.pending = blocks.pop() || "";
      for (const block of blocks) {
        const data = block.split(/\\r?\\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\\n");
        if (!data) continue;
        try { emit(JSON.parse(data)); } catch {}
      }
    };
    const consume = async (body) => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      const state = { pending: "" };
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        parse(state, decoder.decode(next.value, { stream: true }));
      }
      parse(state, decoder.decode() + "\\n\\n");
    };
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") return;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      let requestUrl;
      try {
        const input = args[0];
        requestUrl = new URL(typeof input === "string" ? input : input?.url, location.href);
      } catch { return response; }
      if (!/\\/api\\/rooms\\/\\d+\\/players\\/[^/]+\\/notification$/.test(requestUrl.pathname)) return response;
      if (!response.body || typeof response.body.tee !== "function") {
        emit({ type: "tapUnavailable" });
        return response;
      }
      const [pageBody, trackerBody] = response.body.tee();
      void consume(trackerBody).catch((error) => emit({ type: "tapError", error: String(error) }));
      return new Response(pageBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  })();`;
  const appendScript = (script) => {
    const root = document.head || document.documentElement;
    if (!root) return false;
    root.appendChild(script);
    script.remove();
    return true;
  };
  const appendScriptWhenReady = (script) => {
    if (appendScript(script)) return;
    let finished = false;
    const attempt = () => {
      if (finished || !appendScript(script)) return;
      finished = true;
      observer?.disconnect();
    };
    const observer = typeof MutationObserver === "function"
      ? new MutationObserver(attempt)
      : undefined;
    observer?.observe(document, { childList: true, subtree: true });
    document.addEventListener?.("DOMContentLoaded", attempt, { once: true });
    setTimeout(attempt, 0);
  };
  appendScriptWhenReady(pageTap);
  const configScript = document.createElement("script");
  configScript.dataset.giTcgTracker = "room-config";
  configScript.textContent = `window.__GI_TCG_TRACKER_LOCAL_CHANNEL__ = ${JSON.stringify(channel)}; window.__GI_TCG_TRACKER_PAGE_STREAM__ = ${String(isRainRoom)}; window.__GI_TCG_TRACKER_PAGE_STREAM_CHANNEL__ = ${JSON.stringify(channel)};`;
  appendScriptWhenReady(configScript);
  const sourceUrl = "http://127.0.0.1:8787/bridge/room-sse-collector.js";
  GM_xmlhttpRequest({
    method: "GET",
    url: sourceUrl,
    onload: (response) => {
      if (response.status < 200 || response.status >= 300) {
        console.warn("gi-tcg-tracker: collector source unavailable", response.status);
        return;
      }
      const script = document.createElement("script");
      script.dataset.giTcgTracker = "room-sse-collector";
      script.textContent = response.responseText;
      appendScriptWhenReady(script);
    },
    onerror: () => console.warn("gi-tcg-tracker: 我collector source request failed"),
  });
})();
