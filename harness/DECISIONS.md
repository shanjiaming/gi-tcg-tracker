# Decisions

## 2026-07-15

1. New tracker is a clean independent project. No code or harness file is shared with the old robot
   project.
2. The canonical internal input is `TrackerFrame`, which can come from simulator exact public state,
   semantic HTML, or future vision. The ledger does not know which detector produced it.
3. Simulator state is authoritative for baseline verification, but visibility is preserved: masked
   opponent hand/pile cards remain unknown.
4. The first UI is a low-CPU local HTTP dashboard backed by replayable JSONL. A live page adapter can
   be added without changing the ledger contract.
5. Every card transition must be attributable to an exposed mutation or be marked `unknownHandExit`;
   the engine never silently guesses a played/discarded card.
6. The HTML adapter accepts a semantic observation, not arbitrary DOM guesses. It may submit visible
   local card identities and opponent counts, but omitted identity remains `definitionId=0`; without
   a verified event channel it emits no synthetic played/discarded mutation.
7. For the real rain room, the preferred read-only bridge is the page's own authenticated SSE
   notification stream. `scripts/room-sse-collector.js` mirrors `state + mutation` to local
   `/api/ingest`; DOM scraping remains a fallback for readiness/counts, not the primary event source.
8. The userscript matches both `amechan.7shengzhaohuan.online` and the observed
   `beta.amechan.7shengzhaohuan.online` room origins. The beta page is a real deployment surface, but a
   terminal spectator tab is not sufficient evidence for live userscript installation.
9. The page overlay is created before SSE initialization and reports connection/retry failures visibly;
   the ledger view is rendered only from the local snapshot endpoint. The outer shell remains
   non-interactive, while a bounded inner content region accepts only wheel/touch scrolling; there are
   still no game-input or action controls and polling remains low-frequency.
10. A perspective-specific `/api/state` request may never fall back to the other public perspective's
    replay. If a p1 replay is unavailable before live p1 data arrives, the server returns an empty
    fail-closed snapshot with a warning instead of showing p0 information.
11. The collector registers a per-page live session at `initialized` before requesting state. A new
    page instance resets the corresponding local ledger; until its first live notification, state is an
    explicit waiting snapshot rather than stale replay data.
12. The simulator stress harness must be reproducible by seed. Because the pinned upstream initial-deck
    helper uses unseeded `Math.random()` when `noShuffle=false`, this project pre-shuffles each deck with
    a local deterministic LCG and passes `noShuffle=true`; it does not monkey-patch global randomness or
    modify the upstream checkout.
13. Visibility masking applies to exact mutation payloads as well as state snapshots. A nonzero entity
    definition in an opponent hand/pile mutation is not public by itself; only a public board move, a
    public card play, the local player's own card zone, or an explicitly public transfer may expose it.
14. Stress coverage includes a seed-driven random simulator policy. It is deterministic by construction,
    exercises decision points beyond the fixed heuristics, and is audited under the same public-perspective
    and privacy contracts; it must not be allowed to silently fall back to an unsupported policy mode.
15. Local tracker startup is independent from the room SSE lifetime: after a transient local session
   failure, the page bridge retries registration at one-second cadence without reconnecting the room
   stream; a stale-session takeover response is terminal for that page and is never retried with replace.
16. The Tampermonkey loader uses a randomized `postMessage` channel for local tracker API calls and
   performs them through `GM_xmlhttpRequest`. This is a browser-transport compatibility layer only:
   the page still owns authenticated Rain SSE, the allowed destination is loopback `/api/*`, and no
   game action endpoint or DOM input is exposed.
17. The live room collector binds `initialized.myPlayerInfo.deck` to the current perspective and accepts
    `initialized.oppPlayerInfo.deck` as a separate simulator-only diagnostic deck. The latter may drive the
    UI's opponent-unplayed list, but is not part of the real-vision/RL observation contract; both inputs are
    validated as integer `characters`/`cards` arrays and stored per perspective/session.
16. HTML/content-script observations are untrusted at runtime even when TypeScript declares a complete
   tuple. Missing/primitive entities, malformed public arrays, invalid counts, duplicate card IDs and
   malformed exposed mutation sources fail the whole observation; they are never coerced into empty
   hands or partial event streams.

18. Simulator coverage harnesses may use ordered target-card priorities and explicitly labeled exploration decks, but every
    result must still come from an actual pinned engine action sequence and both public perspectives; generated-card
    presence alone is not enough. In particular, `elementalTuning` is not a discard and cannot be used to claim an
    `onDispose` branch.

19. The tracker owns an optional low-CPU live-simulator acceptance harness. It streams one actual pinned-engine game into
    the same `/api/session` and `/api/ingest` contract used by the browser bridge, then compares the live final snapshot
    with offline replay of that game's trace. This is transport/ledger evidence only: it does not add action control,
    does not connect to the real Genshin client, and does not change the one-game/one-agent control boundary.

20. Real-room smoke is an observer-only acceptance path. It must derive perspective and deck binding from the room's
    `initialized` event, keep the local session alive with heartbeat while waiting for a second player, and query state
    for the same perspective. A remote Agent/renderer stall is recorded separately from tracker ledger correctness and
    is stopped by a bounded cleanup path.
