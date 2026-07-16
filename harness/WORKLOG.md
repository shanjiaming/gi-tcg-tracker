# Worklog

## 2026-07-16

- 修复 page-owned stream 的两个启动边界：重复收到 `tapUnavailable`/`tapError` 时只允许启动一条
  direct-SSE fallback；页面有界队列满时保留最新 `initialized`，避免 collector 加载较慢时丢失
  `who` 和自动导入的本方牌组。新增运行时回归后，单测为 50/50，完整 `npm run verify` 通过
  12 traces / 34,896 notifications / 277 transitions。
- 再用 tracker 创建临时真实房间 3020 做低负载探针：当前 collector 实际收到 `initialized` 和 1 条
  `notification`，本地 sequence=1、38/38 卡面 URL、0 warnings。随后用旧 simulator 的两个独立
  Node SSE client 并行驱动时，它们没有继续获得可用事件，而 collector 已拿到首帧；这再次记录了
  远端 notification 流不能由多个独立 SSE 订阅者竞争的边界。该房间已用房主凭据 giveUp 清理，未把
  这次 transport contention 误判成 tracker ledger 失败。

- 改进 userscript 到 0.3.0：document-start 注入 page-owned notification fetch tee，使用 Response.body.tee()
  将页面原始流和 tracker 副本分开；collector 串行消费有界队列，队列中的 tapUnavailable 也会正确回退到
  独立 SSE。新增 prepare-real-page.ts 作为不依赖旧 robot 运行时的 Chrome DevTools 验收工具。
- 真实房间 454 验证当前页面链路：overlay 由 #1 初始手牌推进到 #10 选择出战、#39 第1回合·投掷骰子，
  tee 队列收到 notification，38/38 卡面 URL 存在，warnings=0，四类牌面均可渲染。旧 DOM driver 后续
  停在 renderer 边界，未把该结果扩大为动作控制或 RL 成功。
- 本轮最终 gate：49/49 单测，syntax/boundary/typecheck 全部通过；npm run verify 通过 12 traces、
  34,896 notifications 和 277 transitions。

- Added the bounded `real-room-collector` harness for a real Rain room when Chrome's long-lived page
  navigation is unavailable. Room 889 was created by the tracker-owned holder and externally driven by
  two simulator clients; the collector received an authenticated initialized event plus a terminal
  notification, auto-bound both decks from the initialized payload, forwarded the frame to the local
  tracker as sequence 1, and recorded phase 5 / round 1 / 38 card identities / zero warnings in
  `records/live/real-browser-room-current-collector.json`. This is direct SSE transport and ledger evidence;
  the separate installed-userscript page evidence remains the room 6349 record below. The external clients
  did not produce a useful multi-round action trace in room 889, so this run does not promote renderer or
  action-driving support.

- Strengthened `audit-trace` to check both directions: every visible card transition must produce exactly one
  matching ledger counter, and every non-zero played/discarded/tuned/transferred counter must have a visible
  mutation explanation. The expanded 42-deck-chunk run covered 84 perspective traces / 283,082 notifications
  with zero audit failures. Then reran the public-entity and conditional groups using legal catalyst and Fontaine
  character profiles, plus a targeted `水与正义` (331805) deck; the combined latest evidence is 59 deck chunks /
  118 perspective traces / 466,513 notifications, with 3,926 played, 403 discarded, 582 tuned and 49 transferred
  events. This is the earlier aggregate; the newer generated-character matrix is recorded in the next bullet.
- Corrected the coverage taxonomy: upstream talent/technique entities use `obtainable=false` even though they enter
  a deck with their character. The report now separates 155 `character-deck-obtainable` runtime cards from 100
  genuinely generated-only runtime entities. Added `generated-decks`, source-element reaction partners and explicit
  deck `targets`; three 11-chunk runs (skills-first, cards/random, random/random) covered 33 chunks / 66 perspective
  traces and 259,631 notifications, all terminal and audit-clean. The latest aggregate is 378 trace-observed / 374
  ledger-event identities, leaving 150 character-deck-obtainable, 42 generated-only and 16 historical/runtime-missing
  cards unobserved; observed examples include Furina's `圣俗杂座`, Escoffier's food/support branches, Chasca's
  `追影弹` variants, Navia's `裂晶弹片`, Sigewinne's generated water balls, Spirit Speaker branches and Guardian
  of Apep's `唤醒眷属`, but not every conditional variant.
- Added an explicit `direct` coverage group for directly obtainable runtime cards whose source has no
  mechanic signal. The simulator generated 6 deck chunks and ran both public perspectives (12 terminal
  traces / 34,955 notifications); audits reported zero warnings, masked leaks, simulator errors or
  non-terminal traces. Rebuilding the aggregate inventory from all automated traces plus the complex-card
  rechecks now reports 586 catalog cards, 334 trace-observed identities and 327 identities with ledger events.
  Of the 252 still unobserved cards, 222 are generated-only, 16 are historical/runtime-missing, and 14 are
  directly obtainable but were not observed under this bounded deck/policy fixture; this is coverage accounting, not a
  full-card correctness claim.
- Fixed the real browser overlay regression found by exercising the simulator-driven userscript fixture:
  an SSE reconnect sends `initialized`, and the collector used to remove/recreate the overlay, resetting
  the scroll position; state polling also replaced the card DOM. The collector now reuses a connected overlay
  and restores its scroll position after redraw/layout. In a clean browser tab, a real wheel scroll moved
  `scrollTop` 0→500, stayed at 500 after 3.2 seconds covering reconnect and the 1.5-second state poll,
  reached the bottom (`scrollTop=1838`, `maxScrollTop=1838`), then returned to 1338. All four sections and
  38 card images remained present; the clean tab emitted no warning/error logs. `npm test` passed 48/48.
- After that change, `npm run verify` passed: 48/48 tests, syntax, boundary scan and strict typecheck;
  12 traces / 34,896 notifications / 277 transitions across seeds 20260715–20260720 and both public
  perspectives, with the existing zero-warning, zero-masked-leak, zero-simulator-error, terminal-trace gates.
- Re-ran all 8 mechanism groups through the simulator, sequentially and from both public perspectives:
  16 traces / 52,850 notifications, zero audit warnings, masked leaks or simulator errors. Then extended the
  harness so `TRACKER_COVERAGE_EXPLORE_MAX_DECKS` can consume multiple generated deck chunks per mechanism;
  the N=2 run executed 10 deck chunks / 20 perspective traces / 61,205 notifications, with 504 played,
  69 discarded, 65 tuned and 9 transferred ledger events, all terminal and audit-clean.
- Rebuilt the aggregate card inventory from all automated mechanism traces plus the complex-card rechecks:
  586 catalog cards, 119 trace-observed identities and 118 identities with ledger events. The complex rows for
  `草与智慧` (331804), `以极限之名` (332044), `赤王陵` (321020), `噬骸能量块` (124051), `亡雷凝蓄`
  (224051) and `夜域赐礼·索报皆偿` (217091) all have visible events and card-face URL evidence. The
  coverage report remains evidence of exercised paths, not a claim that the remaining 467 cards are fully tested.
- Added a card-image invariant to `audit-trace`: every ledger row must carry a validated static-data card-face URL;
  the full `npm run verify` and the complex-card audit pass with this invariant enabled.
- Re-ran the complete local gate after the malformed `state.player` boundary hardening: 36/36
  tests, `syntax-ok 26`, strict TypeScript check, and `verify-project` all passed. The baseline
  verifier covered 12 traces, 34,896 notifications and 277 exposed transitions with zero warnings,
  masked-state leaks, simulator errors or non-terminal traces.
- Re-ran the local HTTP session smoke: first page activation, intentional replacement, stale-page
  rejection, waiting snapshot and fresh sequence reset all passed; default live decks remained
  unknown. `git diff --check` passed and tracker ports 8899/8787 were clear after the run.
- Reconnected to the current Chrome profile for the remaining real-page gate. The earlier room 8158
  was no longer present in the current tab list on 2026-07-16; the available Rain tabs were home/deck
  pages, so no fresh in-progress room was available for an actual Tampermonkey/Violentmonkey capture.
  This leaves the userscript installation gate explicitly pending rather than treating fixture or
  direct-SSE evidence as page-level success.
- Hardened `frameFromHtml` for untrusted runtime input: malformed observations now produce a frame that
  the engine rejects instead of throwing or treating missing players as empty hands; negative/count-
  inconsistent card totals and duplicate explicit hand/pile entity IDs are rejected as well. The
  existing 36/36 suite and strict type check remain green.
- Hardened notification sequencing at the same boundary: a present non-array `state.player` is rejected
  before fingerprinting or sequence consumption, so the normalize step cannot turn malformed payloads
  into an empty-player partial frame.
- Extended the HTML runtime guard to reject primitive/null card/entity entries, malformed optional public
  arrays, mixed-type dice and non-array exposed mutation sources instead of filtering them into a partial
  observation; the existing regression remains 36/36.
- Final current-code verification after both boundary guards: `verify-project` passed with 36/36 tests,
  syntax/typecheck green, 12 traces, 34,896 notifications and 277 transitions; the local HTTP session
  smoke again passed page replacement, stale-page rejection, waiting sequence 0 and fresh sequence 1.
- Added `scripts/check-boundaries.ts` and wired it into `npm run verify`. It scans 28 runtime/test/config files
  and rejects old robot/LumiTracker references plus RL/action-control markers in runtime surfaces; the
  initial self-match/negative-test false positives were corrected, and the boundary gate now passes.
- Added a safe remote-host runbook for `stella.xqm.cloud`: tracker binds to remote loopback and a local
  SSH tunnel keeps the browser/userscript endpoint at `127.0.0.1:8787`; the docs explicitly prohibit
  exposing the current unauthenticated HTTP server on `0.0.0.0`.

## 2026-07-15

- Created `gi-tcg-tracker` as a separate project after the robot project was explicitly shelved.
- Cloned LumiTracker into `../references/LumiTracker` at `1120dda` as a read-only reference.
- Implemented `TrackerFrame`, public-visibility ledger, deck-aware remaining counts, mutation-bound
  card events, JSONL replay and a low-CPU local dashboard.
- Added independent simulator generator and acceptance harness documents.
- Ran 4 sequential pinned-upstream games with two distinct policy modes, recording both public
  perspectives: 8 traces, 23,626 notifications total, zero simulator errors, zero masked-state
  leaks, terminal phase preserved in every trace, and exposed card-transition counts matched by the
  ledger audit. One seed emitted three repeated terminal notifications; the audit now treats that
  as valid and records the count.
- Verified local dashboard endpoints `/api/health`, `/api/state` and `/` against the latest replay.
- Inspected the public simulator home page and upstream web-ui source. The board is dynamic 3D DOM
  with no stable card entity id; added a semantic, fail-closed `frameFromHtml` adapter and a test
  proving visible identity/counts survive while hidden opponent identities remain unknown.
- Implemented the read-only room SSE collector, local `/api/ingest` endpoint, reconnect duplicate
  suppression, and served bridge script route. Synthetic ingest validation passed: preflight 204,
  first notification accepted, reconnect duplicate rejected, visible remove mutation counted as one
  play, and dashboard state switched to the live snapshot.
- Added live `sessionId` isolation and verified that a new room/player starts at sequence 1 with no
  previous-room played count.
- Added a local SSE room fixture with reconnect semantics: the first connection replays the capture,
  later connections replay only the final notification so the bridge's immediate reconnect dedup is
  exercised without appending a second game. A bounded continuous fixture can be selected with
  `TRACKER_FIXTURE_LIMIT` for browser smoke tests.
- Browser-loaded bridge smoke passed against the bounded fixture: page reported `collector loaded`,
  browser error/warn log was empty, live `/api/health` exposed session `http://127.0.0.1:8899:42:p0`,
  and live snapshot reached sequence 241, phase 3, round 1, with zero warnings. The sequence is
  lower than 256 because the live sequencer dropped repeated fingerprints.
- Added `scripts/room-sse-userscript.user.js` as the user-facing Tampermonkey/Violentmonkey loader;
  it fetches the localhost bridge through the userscript permission and injects only the read-only
  collector into matching Rain room pages.
- Fixed the real HTTPS-room failure where the injected collector's page-context `fetch` to
  `http://127.0.0.1:8787/api/session` was blocked by Chrome (`ERR_BLOCKED_BY_CLIENT`). Userscript
  version 0.2.0 now proxies loopback API requests through `GM_xmlhttpRequest` over a randomized
  message channel; source, syntax, unit, boundary, and transport-scope checks pass. Existing installed
  0.1.0 copies must be replaced before the live page can use the fix.
- Added guarded `scripts/real-room-smoke.ts`; with explicit remote-room permission it created two
  temporary guests, observed actual `waiting`/`initialized`/`notification` SSE payloads, forwarded
  one real notification into the local tracker as sequence 1 with zero warnings, and called giveUp
  (201). The three temporary rooms used for this evidence later reported `finished`.
- Initialized a separate local Git repository in `gi-tcg-tracker`; generated catalog and simulator
  records remain ignored, while source and harness files are visible for the first intentional commit.
- Remaining product work is a browser-page installation capture in an authenticated real room; the
  collector is packaged as a user-facing userscript loader, emits the existing `TrackerFrame`
  contract, and stays independent of the old robot. Direct authenticated SSE and local browser
  fixture evidence now cover the transport and ingest layers separately.
- Added a static userscript packaging test covering the Rain-room match, localhost permission and
  collector URL, while rejecting action-response, click and form-submit calls. Final local checks
  pass at that point: 7/7 tests, syntax-ok 22 and strict TypeScript compilation.
- Added a read-only page overlay to the collector. It shows phase, round, public hand/deck counts,
  known card names, ledger rows and warnings without intercepting pointer events; state refresh is
  bounded to one local snapshot request per 1.5 seconds to keep CPU and request pressure low.
- Re-ran the bounded browser fixture after the overlay change: the page showed `collector loaded` and
  `雨酱牌记牌器` with `#241 / 第1回合 / 行动 / 视角0`; browser logs had only the bridge startup info,
  and server state remained sequence 241 / phase 3 / round 1 / zero warnings.
- Added `TRACKER_FIXTURE_USE_USERSCRIPT=1` and ran it in the browser with a minimal GM request shim:
  the page reported `userscript loaded`, the userscript injected the collector and overlay, the only
  browser log was the bridge startup info, and server state remained sequence 241 / phase 3 / round 1
  / zero warnings.
- Connected to the existing Chrome profile and inspected a real beta-domain Rain room tab. The page
  showed an authenticated spectator board and terminal-room UI but no tracker overlay; this exposed
  that the userscript needed beta-domain `@match` entries. Added formal + beta matches and a static
  regression assertion. The tab is not counted as live userscript acceptance because the room is over
  and the userscript was not installed there.
- Changed the collector overlay to appear before SSE initialization and show connection/retry errors;
  this gives a real-page diagnostic without adding polling. Re-ran the browser userscript fixture:
  it settled at `#241 / 第1回合 / 行动 / 视角0`, runtime `pointer-events:none`, one bridge info log,
  and local snapshot sequence 241 / phase 3 / round 1 / zero warnings.
- Audited live state fallback and fixed a perspective leak: p1 state no longer falls back to p0 replay
  before p1 live data arrives. Matching `-p1.jsonl` is selected when available; otherwise the API is
  explicitly empty with a warning. Added a pure resolver regression test.
- Audited the initialized-before-first-notification race and added `/api/session`. The collector now
  registers a unique page instance before polling, the server resets a replaced page session, and the
  state endpoint returns an explicit waiting snapshot until live data arrives instead of stale replay.
- Re-ran the userscript loader in a clean single-page fixture against the full captured stream. The
  page reported `userscript loaded`, reached dynamic frame `#2180` with public counts and known local
  cards, and later kept the terminal `#2601` ledger after the SSE stream completed; it did not show a
  disconnect overwrite and emitted only the read-only bridge startup info. The same-perspective
  multi-tab race was also observed and documented as intentional page-session takeover behavior.
- Added public character enrichment and UI rendering: the tracker now names visible characters and
  shows active, HP, energy and defeated status in both dashboard and room overlay. A 256-frame low-load
  browser fixture showed the new text. This also exposed and fixed an existing dashboard inline-script
  escaping bug; a fresh dashboard page now renders with no console errors, and the test suite parses the
  embedded script to prevent regression.
- Ran two additional unseen pinned-upstream seeds locally (`20260719`, `20260720`) from both public
  perspectives: four traces, 11,270 notifications, terminal phase 5 on every trace, zero simulator
  errors, zero masked-state leaks and zero tracker warnings.
- Fixed the multi-page session race: first registration may explicitly replace an old page, same-page
  reconnects reuse its session, and stale-page reconnect registration or delayed ingest now returns 409.
  A live HTTP check confirmed page A sequence 1, intentional page B replacement, stale A rejection,
  waiting sequence 0, then page B sequence 1. The check is preserved as the explicit local-only
  `scripts/server-session-smoke.ts`; it is not part of the ordinary no-listen unit test command.
- Separated replay and live deck configuration. Replay still uses `TRACKER_DECK0/1`, while live now
  defaults both sides to unknown and only uses explicitly configured `TRACKER_LIVE_DECK0/1`; the local
  session smoke asserts both live `knownDeck` flags stay false by default and `[true,false]` when only
  `TRACKER_LIVE_DECK0` is explicitly configured.
- Hardened collector stream completion by flushing `TextDecoder` and the final partial SSE block before
  reconnecting; the static bridge test now guards this tail-frame path.
- Added `TRACKER_FIXTURE_UNTERMINATED_LAST=1` and verified it through the browser userscript loader with
  a one-frame fixture: the unterminated final notification rendered as `#1 · 初始手牌` with only the
  read-only bridge startup info in browser logs.
- Extended the public snapshot/UI with combat status, summons, supports, dice, declared-end and legend
  flags. A low-load 200-frame browser fixture reached a support entity; fresh overlay and dashboard
  pages rendered `湖中垂柳`, dice and character state, while unknown entity IDs stayed as IDs without
  invented names.
- Re-ran the final local gate after the public-state expansion: 20/20 tests, syntax-ok 23, strict
  TypeScript compilation, latest 2,538-notification trace audit, and the local page-a/page-b session
  isolation smoke all passed. The only remaining acceptance item is installing the packaged
  Tampermonkey/Violentmonkey loader in an actually in-progress authenticated room page.
- Audited simulator mutation semantics against the pinned upstream source: hand-to-character/support
  `moveEntity` transitions are now counted as played cards, status-area `removeEntity` mutations are
  ignored by the card ledger, and numeric plus lower-camel/enum-style play reasons are normalized.
  The audit was expanded and all 12 existing traces passed with zero warnings.
- Hardened partial-state handling: omitted player fields and top-level phase metadata preserve the
  latest known public snapshot, while explicit empty hand arrays retain the fail-closed unknown-exit
  warning rule. Duplicate-frame warnings now update the returned snapshot immediately.
- Cached replay snapshots per perspective so the low-CPU dashboard no longer re-reads/replays the
  large JSONL trace on every one-second poll; local session isolation smoke still passes afterward.
- Re-ran the complete 12-trace matrix after the transition and partial-state fixes: 34,896
  notifications and 271 exposed card-transition keys, with zero warnings, masked-state leaks or
  simulator errors; all traces ended at phase 5.
- Covered mutation-only partial notifications as well: explicit hand transitions now update the
  known-hand list and count even when the accompanying state omits the player payload, without
  inventing any masked identity.
- Performed a read-only probe of a real Rain-jiang room 7999 on 2026-07-15. The authenticated
  page rendered the board, turn/round, public characters, visible cards and dice, while exposing
  no `data-gi` semantic markers and no tracker overlay. This is live visual-boundary evidence,
  not userscript-installation evidence; the remaining gate is still a user-side Tampermonkey or
  Violentmonkey install plus capture from an actually in-progress room.
- Re-audited the upstream mutation model and fixed two ledger edge cases: cross-side hand/pile moves
  now close the source location as an explicit `transferred` ledger event (subtracting it from the
  source deck's remaining count) without generating a false unknown exit or play, and create/transform
  mutations in non-card zones no longer pollute the card ledger. The live sequencer also normalizes a
  malformed non-array mutation field to an empty list. Tests are 23/23, and the full 12-trace matrix
  remains clean with 34,896 notifications, 271 transition keys, zero warnings/leaks/errors and phase 5
  terminal state on every trace.
- Re-ran a low-load local browser fixture after the transfer column/UI change. The room overlay reached
  live frame `#191` with public characters, active marker, HP/energy, support and masked opponent hand;
  the dashboard rendered the new `转移` ledger column, and the browser emitted no warning/error logs.
- Audited all exposed `removeEntity` reason/area combinations in the generated traces against upstream
  `mutator.ts`: hand removals with `EQUIP_OVERRIDDEN`/`CREATE_SUPPORT_OVERRIDDEN` are consumed plays,
  not discards. The engine, audit script and regression test now agree on those numeric and enum-style
  reasons.
- Re-ran the full matrix after the reason classification change: 24/24 tests, 12 traces, 34,896
  notifications, 271 transition keys, zero warnings/masked-state leaks/simulator errors and terminal
  phase 5 on every trace.
- Added partial-frame public mutation patches: exposed `switchActive` and `setPlayerFlag` now update
  active character, declared-end and legend-used state even when the notification omits `player`.
  This keeps the out-of-band public state linked to the same snapshot instead of retaining stale facts.
- The first partial-patch test exposed an early-return bug in the missing-player path; that path now
  applies the same patches before returning. Final regression is 25/25 tests plus the clean 12-trace
  matrix (34,896 notifications, 271 transition keys, zero warnings/leaks/errors, terminal phase 5).
- Extended the same partial-frame contract to top-level `changePhase`, `stepRound`, `switchTurn` and
  `setWinner` mutations; a no-player frame can now keep phase/round/turn/winner synchronized without
  guessing any hidden card information.
- Re-ran the complete regression after the top-level patch work: 26/26 tests, strict typecheck, and
  all 12 traces clean with 34,896 notifications, 271 transition keys, zero warnings/leaks/errors and
  terminal phase 5.
- Added `scripts/verify-project.ts` and the `npm run verify` entry point. It is intentionally sequential
  and no-listen: tests, syntax, strict typecheck and the default 12-trace audit now share one hard-gated
  local command, while the HTTP session smoke remains a separately permissioned check.
- The new single-entry verifier itself passed: 26/26 tests, syntax-ok 24, strict typecheck, 12 traces,
  34,896 notifications and 271 transition keys.
- Strengthened `audit-trace.ts` so the dynamic matrix now compares discarded and transferred counts in
  addition to played/tuned counts; the verifier no longer treats those two ledger categories as
  untested side effects.
- Re-ran the single-entry verifier after the expanded ledger audit: 26/26 tests, syntax-ok 24, strict
  typecheck, 12 traces, 34,896 notifications and 277 exposed transition keys; all warnings, masked
  leaks, simulator errors and non-terminal traces remained at zero. The local page-a/page-b session
  isolation smoke also passed with stale-page rejection and live decks remaining unknown by default.
- Added the page-level `live-acceptance` harness. It requires `/api/health` to expose the requested live
  session and `/api/state` to expose a nonzero live sequence, so a replay snapshot cannot pass by itself;
  it writes bounded JSON evidence to ignored `records/live/` and never starts a remote room or sends a
  game action.
- Exercised both acceptance branches: an unavailable local endpoint produced `ok:false` and a local
  registered session plus one ingested notification produced `ok:true` with `livePerspectives:[0]` and
  `sequence:1`. The temporary tracker listener was stopped afterward. The full verifier then passed
  with 26/26 tests, syntax-ok 25, strict typecheck, 12 traces, 34,896 notifications and 277 transitions.
- Expanded simulator evidence beyond the fixed baseline. The first stress run exposed that upstream
  initial-deck shuffling used unseeded `Math.random()` and made identical seed/policy runs diverge;
  the generator now pre-shuffles with a deterministic LCG and passes `noShuffle=true`. Two repeated
  `20260721 / skills:cards` runs produced identical p0/p1 SHA-256 values. The corrected default stress
  matrix passed 8 games, 16 traces, 55,649 notifications and 371 transition keys with zero warnings,
  masked leaks, simulator errors or non-terminal traces, covering all observed mutation names.
- Re-ran the primary `verify-project` gate after the deterministic generator change: 26/26 tests, syntax-ok
  26, strict typecheck, 12 baseline traces, 34,896 notifications and 277 exposed transition keys; all
  baseline warnings, masked leaks, simulator errors and terminal-phase checks remained clean.
- Added opt-in stress failure retention via `TRACKER_STRESS_KEEP_FAILURES=1`; ordinary runs still delete
  their temporary traces, while a failing run can now preserve the exact generated evidence for analysis.
- The expanded stress matrix exposed a privacy gap that the original fixed tests missed: exact simulator
  `createEntity`/draw/tuning payloads could carry nonzero opponent hand/pile definitions and the engine
  retained them. The engine now masks those identities by perspective, while retaining public opponent
  plays and board moves; the audit also checks `maskedSnapshotLeaks` after every frame.
- Added a regression for hidden exact mutations and public opponent plays. Unit tests are now 27/27, and
  the default 8-game/16-trace stress matrix still passes with 55,649 notifications, 371 transitions,
  zero warnings, zero simulator errors and zero masked-snapshot leaks.
- Re-ran the primary verifier and HTTP session smoke after the visibility fix: 27/27 tests, syntax-ok 26,
  strict typecheck, 12 baseline traces with 34,896 notifications/277 transitions, plus page-a/page-b
  takeover, stale-page rejection and default unknown live decks all passed.
- Strengthened dynamic audit with per-frame hand/pile count reconciliation whenever those public arrays are
  present; this keeps the identity mask and the quantity contract checked independently.
- The count reconciliation passed both gates: baseline 12 traces (34,896 notifications) and strategy stress
  16 traces (55,649 notifications), with every explicit hand/pile array matching the snapshot quantity.
- Added explicit `verifiedCardEvents` output to each audit and aggregate card-transition coverage to the
  stress report, making played/discarded/tuned/transferred coverage visible instead of hiding it in the
  unique transition-key total.
- The resulting stress aggregate is played=470, discarded=1, tuned=58, transferred=0. The zero transfer
  result is an explicit simulator-policy coverage fact rather than a silently assumed pass; cross-side
  transfer remains exercised by the unit regression.
- Added explicit regressions for local tuning/discard removal and local hand-to-pile/pile-to-hand events;
  the suite is now 29/29, while the public identity/count and fail-closed mutation contracts remain intact.
- Added a deterministic random simulator policy covering switch-hands, reroll, select-card, choose-active
  and action decisions. The default stress gate now runs 12 games/24 perspective traces, repeats its first
  random pair with p0/p1 SHA-256 comparison, and passed with 80,566 notifications, 544 transitions,
  played=636, discarded=4, tuned=118 and transferred=0. The repeat hashes were
  `p0=2580060ee36c8a0d6a1dc9803957bdf356398e39d1b60c4b6d798d82903464b5` and
  `p1=0f88afb589fee442e58bf3b415bb31fa8490eb4e4e2291400f2d9dc4b3942574`.
- Ran an independent random-heavy matrix with unseen seeds 20260723–20260725 and five mixed policy pairs;
  all 15 games/30 perspective traces passed with 103,156 notifications, 627 transitions, zero warnings,
  zero simulator errors, zero masked leaks and matching public hand/pile counts.
- Hardened the page collector's live boundary: a local tracker that starts after the room SSE now receives
  bounded one-second session-registration retries, while a stale-page 409 stops retries and cannot reclaim
  another page's session. Room paths are numeric-only and player IDs are URL-encoded before SSE fetch.
- Audited the HTML stub's synthetic entity identity policy and found a real hand/pile collision when the DOM
  supplied no entity IDs (including the same visible definition in both zones). Zone-specific ID ranges now
  keep those cards separate; the regression suite is 30/30 and the baseline contracts remain unchanged.
- Expanded the HTML observation contract with explicit public combat statuses, summons, supports, dice and
  player flags, keeping the DOM fallback aligned with the SSE snapshot without guessing masked identities;
  the regression suite is now 31/31.
- Hardened the notification boundary so null, array and scalar states fail closed before fingerprinting or
  sequence allocation; a malformed live payload can no longer advance the tracker as an empty state.
- Added a runtime Node VM collector fixture for the delayed-local-start race: same-chunk initialized and
  notification events, first session POST 503, second POST success; the notification was forwarded exactly
  once after session readiness. The suite is now 33/33.
- Closed the stale-page ingest branch: a 409 now marks the page terminal, aborts its SSE and suppresses
  reconnect instead of leaving an old tab in a retry loop.
- Hardened the engine entrypoint itself against malformed state, illegal perspective and non-array mutation
  fields; this protects future DOM/vision adapters even when they bypass notification normalization.
- The direct engine boundary now also rejects a present-but-non-array `state.player`, while still accepting
  legal mutation-only partial frames with no `player` field.
- Hardened dashboard rendering by escaping character details, side counts and card-table numeric cells;
  the dashboard syntax/escaping regression remains green alongside the 33-test suite.
- Added a runtime dashboard VM fixture with HTML-shaped values in phase, character, card, event and warning
  fields; it observed escaped text only and no executable tags. The suite is now 34/34.
- Added direct engine boundary regressions for malformed state, illegal perspective and non-array mutations;
  these now fail closed before a DOM/vision adapter can crash the ledger. The suite is now 35/35.
- Made `TrackerEngine.apply()` return a recursively frozen snapshot rather than a mutable internal object; a
  caller can no longer corrupt subsequent frames, without cloning the full snapshot on every notification.
  The suite remains 36/36; the current default stress passed with 80,566 notifications in 19.36 seconds wall
  time (27.59 seconds user CPU) and unchanged 544 transitions.
- Changed the user-facing tracker view to two card lists only: current local-deck cards and all publicly
  confirmed opponent plays. Added `knownPile` plus card-face image URLs from the upstream static-data API,
  grouped duplicate cards with counts, and validated image origins in both dashboard and room overlay.
  Unknown live deck identities remain omitted. The updated suite passes 36/36 and syntax/boundary checks.
- Added automatic real-room deck binding: Rain's `initialized.myPlayerInfo.deck` now travels through the
  userscript's local session registration and overrides only that perspective's live engine. The server
  rejects malformed deck arrays, ignores the opponent deck, and the HTTP session smoke proves the override
  makes `liveDeck=true` without a manually supplied deck code. The suite is now 38/38.
- Expanded the tracker to four card lists: local played, local deck remaining, opponent publicly played and
  simulator-only opponent unplayed. The collector now forwards both initialized deck objects to the local
  session boundary, the engine exposes `unplayedCount`, and the real-vision/RL boundary documents that the
  opponent diagnostic deck is not a valid observation. Added opponent-deck session smoke and regressions;
  the suite is now 39/39, full verify passes, and the restarted local tracker serves all four sections.
- Audited representative special content: `草与智慧` (331804), `以极限之名` (332044), `赤王陵` (321020),
  `圣骸毒蝎` (2405), `希格雯` (1213), and related talent/generated-card definitions are present in the
  pinned catalog. Added local visible dynamic-pile handling so generated cards such as `禁忌知识` remain
  visible beside imported deck cards. The suite is now 40/40 and the full verify gate remains green.
- Diagnosed the live room 1437 reconnect loop: the tracker bridge's notification request returned HTTP 404
  (`Room not found`). A 404 is now terminal for that collector, with an explicit "room not found or player
  left" overlay instead of an infinite one-second retry; the restarted local tracker serves this branch.
- Fixed the room overlay viewport issue: the shell keeps its read-only game-safe boundary, while a bounded
  inner content region now accepts wheel/touch scrolling, has a thin scrollbar and remains action-free;
- Repaired the overlay long-list implementation after a real browser check showed the first bounded layout
  was still not reliably scrollable on the simulator page. The shell now has a stable viewport height and
  flex layout; the content region owns scrolling and has a local wheel fallback. Extended the simulator
  fixture with optional `TRACKER_FIXTURE_DECK` / `TRACKER_FIXTURE_OPPONENT_DECK` injection, then drove a
  30-card deck through the browser: `scrollHeight=1369`, `clientHeight=709`, and wheel scrolling changed
  `scrollTop` from 0 to 520. The code suite remains green.
  long four-section card lists no longer disappear below the browser viewport.
- Added `scripts/audit-card-coverage.ts` and `npm run coverage`: the current default trace inventory is
  explicit evidence rather than a guessed full-card claim (586 catalog action cards, 32 observed and 554
  unobserved in the existing baseline). It also records source mechanism signals and writes ignored JSON
  evidence under `records/coverage/`.
- Fixed the catalog exporter to parse upstream `.gts` `define card { id ... }` blocks as well as `card(id)`;
  regenerated catalog now contains 586 action-card entries and includes `深渊的呼唤` (332015).
- Added separate mechanism decks and ran two target-prioritized, two-perspective simulator games covering
  hand exchange, generated pile cards, generated hand cards, return-to-deck, transform, steal, talent
  equipment and discard/selection paths. The 3,817-frame and 4,006-frame pairs both ended in phase 5 with
  zero simulator errors, warnings or masked-state leaks; this is mechanism evidence, not a full-card pass.
- Added a direct `transformDefinition` regression for a visible generated pile identity; the unit suite is
  now 41/41 and the transform-targeted 4,322-frame two-perspective game emitted one transform mutation per
  perspective with zero warnings or masked-state leaks.
- Extended the coverage inventory with pinned runtime metadata. The report now separates the 586 exported
  catalog entries from the current runtime action-entity totals (directly obtainable versus generated-only)
  and marks catalog definitions that are absent from the current runtime, so unobserved generated/internal
  identities are not treated as missing constructible-card support.
- Added `scripts/generate-coverage-decks.ts` / `npm run coverage-decks`, which turns source mechanism signals
  into small target-prioritized decks without mixing them into the standard baseline. Sequentially audited four
  new one-game pairs (hand exchange, generated pile, return-to-deck, cross-side hand transfer): 8 traces and
  28,372 notifications reached phase 5 with zero simulator errors, warnings, or masked-state leaks. The union
  report is `records/coverage/mechanism-exploration-20260723-26.json`; it is deliberately recorded as mechanism
  evidence rather than a full-card correctness claim.
- Extended that bounded exploration with discard/tuning and selection groups using different side policies.
  The two new pairs added 4 traces and 13,298 notifications; both perspectives reached phase 5 with zero
  simulator errors, warnings, or masked-state leaks, including real `selectCardDone`, tuned and discarded events.
  The six-group union is `records/coverage/mechanism-exploration-20260723-28.json` with 52 observed identities
  and 41,670 notifications total; it remains an evidence report, not a full-card gate.
- Added dice-payment and conditional-branch groups with different fixed/random/skill policies. The two pairs
  added 4 traces and 12,496 notifications; all four audits ended at phase 5 with zero simulator errors,
  warnings, or masked-state leaks. The eight-group union is `records/coverage/mechanism-exploration-20260723-30.json`
  with 74 observed identities, 73 identities with ledger events, and 54,166 notifications total; it remains
  an evidence report, not a full-card gate.
- Found and fixed an HTML adapter collision boundary: a synthetic unknown-card ID could equal an explicit entity ID
  and overwrite the other card in the engine. Duplicate validation now runs on the fully rendered hand/pile IDs,
  not only on IDs explicitly supplied by the page. Added the regression; the suite is now 42/42, syntax and
  boundary checks remain green.
- Added `scripts/run-coverage-exploration.ts` / `npm run coverage-explore` to make mechanism exploration reproducible:
  it runs one game per selected mechanism sequentially, audits both public perspectives, and writes a report while
  failing on either side's warnings, errors, leaks, or non-terminal state. Its target list is joined back to the
  coverage report so filler cards are not mistakenly treated as mechanism targets. A one-group rerun produced
  5,976 notifications with zero audit failures.
- Ran the new default two-group orchestrator with hand-exchange and generated-pile decks. The four resulting
  perspective traces produced 11,626 notifications; all ended at phase 5 with zero simulator errors, warnings,
  or masked-state leaks. Evidence is `records/coverage/automated-exploration-20260733.json`.
- Extended the orchestrator to all eight mechanism groups for a low-load reproducible run: 16 perspective traces,
  52,850 notifications, all terminal, with zero simulator errors, warnings, masked-state leaks or audit failures.
  The aggregate `npm run coverage` report contains 586 catalog cards, 74 trace-observed identities and 72 identities
  with ledger events at `records/coverage/automated-exploration-20260735-coverage.json`; it remains mechanism evidence,
  not a full-card correctness claim.
- Re-ran the guarded remote guest-room smoke after the harness/UI changes: temporary room 5438 delivered an
  authenticated notification accepted as local sequence 1 / phase 0 with zero warnings, and remote cleanup returned
  `giveUp` HTTP 201. The local tracker was restarted afterward, leaving no live session. This is transport evidence,
  not the pending real Tampermonkey-in-an-active-user-room acceptance gate.
- Found and fixed a low-load HTML boundary: a malformed visible `handCount`/`pileCount` could be an enormous safe
  integer and make the adapter allocate synthetic entities in an unbounded loop. Counts are now capped at 256 and
  rejected before allocation. The new regression brings the suite to 43/43; full verify still passes all 12 traces,
  34,896 notifications and 277 transitions.
- Applied the same resource boundary to automatic deck binding: `normalizeDeck` now rejects more than 16 characters
  or 256 cards before `cardMap`/ledger work. The regression covers both oversized arrays; the 43/43 suite and full
  12-trace verify remain green.
- Exercised the running `/api/session` endpoint with a 257-card payload: it returned HTTP 400 and `/api/health`
  remained free of live sessions afterward.
- Extended the HTML resource hardening to public entity arrays, nested attachments and exposed mutation arrays:
  limits are 256 entities, 8 attachment levels and 1,024 mutations. Oversized entities, deep recursion and mutation
  volume now fail closed; the new regression brings the suite to 44/44 and full verify remains green.
- Hardened the SSE normalization boundary after finding that `handCard:[null]` or `combatStatus:"bad"` was being
  filtered into an empty array. Invalid notification entity structure now rejects the whole frame before sequence
  allocation, while character lists are capped at 16 and HP/energy fields are preserved by a dedicated character
  normalizer. The suite is now 47/47 and full verify still passes all 12 traces / 34,896 notifications.
- Browser regression on simulator seed 20260719 exposed and fixed a fixture-only bug: the GM shim dropped POST
  method/body and caused false session HTTP 404s. With the corrected shim, userscript mode reached live sequence 299,
  phase 3, zero snapshot warnings and a 30-card scrollable overlay; wheel scrolling moved `scrollTop` to about 520.
- Used the separate robot project's `run-public-browser-smoke.ts` without importing or modifying its code. It created
  real Rain rooms 7737 and 1363, joined opponents, and drove the page with simulator agents; 1363 completed one
  page-owned `switchHands` response before the Rain renderer stalled, while 7737 stalled before response in Node-owned
  mode. Both rooms reached `finished` after bounded process shutdown. That foreign script does not retain guest tokens
  for `giveUp`, so this remains renderer-boundary evidence rather than a room-cleanup claim.
- Added the tracker-owned `scripts/real-browser-room.ts` / `npm run real-browser-room`. It creates and joins a
  temporary remote guest room, writes short-lived credentials only to ignored `records/live/`, holds the process with
  a low-frequency timer, and calls authenticated `giveUp` on SIGINT/SIGTERM. The first implementation exposed a
  top-level-await lifetime bug that exited with code 13 before cleanup; it was fixed and the orphaned room 6891 was
  explicitly cleaned with `giveUp` HTTP 201.
- Ran the tracker-owned browser acceptance in room 6349. The current Chrome page had the real installed Tampermonkey
  loader, displayed `雨酱牌记牌器`, and forwarded authenticated live notifications into the local tracker. The overlay
  reached `#37` during the round and `npm run live-acceptance` recorded sequence 38 / terminal phase 5 / zero warnings
  at `records/live/real-browser-room-20260716-acceptance.json`. Two external simulator processes only advanced the
  room; they were not imported into this project. The page was observer-only and the tracker sent no actions. The
  tracker-owned host cleanup returned `giveUp` HTTP 201; browser tabs and external processes were then closed.
- Fixed stale live-session state found during that acceptance: the server now expires sessions after 15 seconds without
  activity, and the read-only collector sends a 5-second heartbeat through the existing local session endpoint. Added
  freshness unit coverage and server-session heartbeat coverage; the suite is now 48/48. After closing the real page,
  the tracker was restarted once to remove the pre-fix stale session; the final health check reported no live sessions.
- Rechecked the end-to-end path with tracker-owned room 2897, standard-a decks, the real installed Tampermonkey page,
  and two external pybinding `VariedPlayer` drivers from the separate robot project. The page/collector delivered 31
  live frames into the tracker with zero tracker warnings, but the remote game failed during reroll before any card play;
  the four ledgers therefore correctly remained empty. This is recorded as a remote driver/renderer boundary, not a
  ledger failure. The room was explicitly cleaned with host `giveUp` HTTP 201, temporary credentials were deleted, and
  the tracker was restarted with an empty live-session health report.
- Ran a local strategy-diverse simulator acceptance with standard-a decks: both public-perspective traces reached phase 5
  with 4,529 notifications and 55 verified plays per audit. A second local complex/scorpion deck run reached phase 5 on
  both perspectives (4,484 / 4,483 notifications), with 65 plays, 11 discards and transfer/generation activity; ledger
  rows for `草与智慧` (331804), `以极限之名` (332044), `赤王陵` (321020), `噬骸能量块` (124051), `夜域赐礼·索报皆偿`
  (217091) and `亡雷凝蓄` (224051) all carried catalog-backed card images. Full `npm run verify` remains green:
  48/48 tests, 12 traces, 34,896 notifications and 277 transitions.
- Re-ran the separate robot project's bounded public-browser method with the known-good split: host used
  `run-browser-simulator` against a real Rain page and opponent used `run-simulator`, with page-owned responses,
  three-request maximum and 45-second timeout. Temporary room 5591 produced a real `switchHands` request/response
  on the page-driven host; the pure SSE opponent stopped at the same reroll boundary without a response. Both
  processes and the isolated Chrome exited, and the room later reported `finished`. This confirms the driver/renderer
  boundary and must not be used as a tracker ledger failure.
- Re-ran the pinned complex/scorpion simulator locally with both public perspectives. The traces reached phase 5 with
  3,748/3,747 notifications; both audits reported zero errors, zero warnings, zero masked-state leaks, and the target
  rows for `草与智慧` (331804), `以极限之名` (332044), `赤王陵` (321020), `噬骸能量块` (124051), `夜域赐礼·索报皆偿`
  (217091) and `亡雷凝蓄` (224051) all had catalog-backed images. The full project gate then passed with 48/48 tests,
  12 traces, 34,896 notifications and 277 transitions.
