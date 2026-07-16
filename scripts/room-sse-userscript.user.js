// ==UserScript==
// @name         GI-TCG Tracker room bridge
// @namespace    gi-tcg-tracker
// @version      0.2.0
// @description  Read-only notification collector for a Rain-jiang simulator room.
// @match        https://amechan.7shengzhaohuan.online/rooms/*
// @match        http://amechan.7shengzhaohuan.online/rooms/*
// @match        https://beta.amechan.7shengzhaohuan.online/rooms/*
// @match        http://beta.amechan.7shengzhaohuan.online/rooms/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(() => {
  const channel = `gi-tcg-tracker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const configScript = document.createElement("script");
  configScript.dataset.giTcgTracker = "room-config";
  configScript.textContent = `window.__GI_TCG_TRACKER_LOCAL_CHANNEL__ = ${JSON.stringify(channel)};`;
  (document.head || document.documentElement).appendChild(configScript);
  configScript.remove();
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
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    },
    onerror: () => console.warn("gi-tcg-tracker: 我collector source request failed"),
  });
})();
