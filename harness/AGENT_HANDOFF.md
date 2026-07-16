# Agent handoff

## Latest continuation note — 2026-07-16

- The current userscript is 0.3.0. It runs at document-start, tees the Rain page's own notification
  fetch with Response.body.tee(), and lets the page keep the original response while the tracker consumes
  a bounded copy. This was added after a real-room comparison showed the page driver receiving 15
  notifications while a parallel Node SSE collector received only the first frame; that comparison is
  transport evidence, not proof of a server-side single-subscriber rule. The direct collector remains the
  fixture/fallback path.
- A fresh tracker-owned room 454 was tested with the current userscript source in an isolated Chrome
  profile and the external simulator driver. The page overlay advanced from #1 to #10 and then #39
  (第1回合 / 投掷骰子), the page tee queue contained notification events, the live snapshot had 38/38
  card images and zero warnings, and the four card sections were rendered. The old DOM driver still
  stopped at a renderer boundary after the bounded page gestures; this does not promote action control.

- The user explicitly asked to continue by opening simulator rooms and using the existing external driver
  method. A new tracker-owned room 889 was created and two external `gi-tcg-robot` simulator clients were
  attached without importing that project into tracker runtime. Because the browser extension navigation
  remained blocked on the Rain page's long-lived request, tracker now has a separate read-only
  `npm run real-room-collector` harness. It consumed the authenticated room SSE, auto-bound both initialized
  decks, ingested a terminal phase-5 frame as sequence 1 with 38 card identities and zero warnings. Evidence:
  `records/live/real-browser-room-current-collector.json`.
- Room 889 ended in round 1 before a useful multi-round action trace was captured. Treat this as real
  transport/ledger evidence only. Do not claim that the Rain renderer or tracker can submit actions; do not
  extend it into the RL boundary. The holder process and two external clients should be stopped after the
  current audit, and the holder's SIGINT cleanup calls authenticated `giveUp`.
- The simulator-driven coverage continuation is now complete for all 155 runtime character-deck talent/technique
  cards: `coverage-generated` ran 114 generated profiles / 228 public-perspective traces / 945,159 notifications,
  all terminal and audit-clean. A driver bug found during this run was fixed: exposed action oneofs carry their
  fields under `.value`, so target-card and skill-priority selection had previously been ineffective.
- Additional parent-entry traces covered Kachina `216101`, Spirit Speaker `121055/121056`, and generated-only
  identities including `300009`, `302208`, `302226/302228`, and `333022/333025/333026`. Current merged aggregate
  is 586 catalog cards, 543 trace-observed and 536 with ledger events; the remaining 27 are generated-only
  conditional/blessing branches and 16 are historical/runtime-missing. This remains exercised-path evidence,
  not a claim that every generated branch is reachable in the current runtime.

## Active objective

完成独立的雨酱牌记牌器；输入源可以是 pinned simulator、房间 SSE、HTML/content-script 或
未来视觉采集，所有输入必须落到 `TrackerFrame`。

## Verified now

- `test/*.test.ts`: 50/50 passed;
- Latest `npm run verify` also passed syntax, boundary scan and strict typecheck, auditing 12 traces,
  34,896 notifications and 277 transitions across seeds 20260715–20260720 from both public perspectives;
  all existing warning, masked-leak, simulator-error and terminal-phase gates remained clear.
- `audit-trace` now checks both directions of the four externally auditable ledger categories, preventing
  unaccounted extra played/discarded/tuned/transferred events from passing. The expanded simulator run covered
  42 generated deck chunks / 84 perspective traces / 283,082 notifications; legal catalyst/Fontaine profiles
  and a targeted `水与正义` deck added 17 more chunks / 34 perspective traces / 183,431 notifications. The newer
  generated-character matrix is recorded below; the old aggregate counts in this historical bullet are not current.
- Coverage taxonomy now separates `character-deck-obtainable` talent/technique cards from genuinely
  `generated-only` entities: the pinned runtime contains 155 character-deck cards and 100 effect-generated
  entities. The new `generated-decks` harness now injects source-element reaction partners and generated explicit
  `targets`; three 11-chunk runs (skills-first, cards/random, random/random) ran 66 perspective traces and 259,631
  notifications, all terminal and audit-clean. The latest aggregate reports 378 trace-observed and 374 ledger-event
  identities; 150 character-deck-obtainable, 42 generated-only and 16 historical/runtime-missing cards remain
  unobserved. This is coverage evidence, not a full-card correctness claim.
- The explicit `direct` coverage exploration for un-signaled but directly obtainable runtime cards passed 6
  generated deck chunks / 12 perspective traces / 34,955 notifications, all terminal and audit-clean. The
  aggregate inventory across automated traces and complex-card rechecks is now 586 catalog cards, 334
  trace-observed identities and 327 identities with ledger events; 222 unobserved cards are generated-only,
  16 are historical/runtime-missing, and 14 directly obtainable cards were not observed under this bounded
  deck/policy fixture.
  These numbers are coverage evidence, not a full-card correctness proof.
- The simulator exploration harness now supports `TRACKER_COVERAGE_EXPLORE_MAX_DECKS` instead of silently
  stopping at `*-001.json`. The fresh N=2 run covered 10 generated deck chunks / 20 perspective traces /
  61,205 notifications sequentially, with 504 played, 69 discarded, 65 tuned and 9 transferred events;
  every audit was terminal with zero warnings, masked leaks or simulator errors.
- Aggregate coverage across the automated traces and complex-card rechecks is now 586 catalog cards,
  119 trace-observed identities and 118 identities with ledger events. `audit-trace` also requires every
  ledger row to contain a validated static-data card-face URL. This is still exercised-path evidence, not
  a full correctness proof for all 586 card implementations.
- The long overlay was checked in a clean simulator-driven userscript browser tab after the tracker was
  restarted to serve the current bridge: real CUA wheel scrolling moved `scrollTop` 0→500 and it remained
  500 after 3.2 seconds spanning an SSE reconnect and state polling; bottom scrolling reached
  `maxScrollTop=1838` and upward scrolling returned to 1338. The four requested section headings and 38
  image tiles were still present, with no fresh browser warning/error logs. The fix covers both reconnect
  overlay recreation and ordinary snapshot redraw; it does not claim visual recognition or real-client support.
- `npm run coverage` is the card-breadth inventory: the current catalog has 586 action-card entries,
  all 586 source blocks are indexed, and the default traces cover only a subset. It also joins the pinned
  runtime entity table and labels cards as directly obtainable, generated-only, or historical/runtime-missing;
  do not call this a full-card correctness gate.
- `npm run coverage-decks` creates ignored mechanism-group decks from directly obtainable runtime cards.
  The earlier bounded mechanism exploration used 16 traces / 54,166 notifications across hand exchange, generated piles,
  return-to-deck, cross-side hand transfer, discard/tuning, selection, dice payment and conditional branches;
  all ended at phase 5 with zero audit warnings or leaks and 74 observed card identities. This remains mechanism
  evidence, not full-card or full-branch promotion.
- The reproducible `npm run coverage-explore` run for all eight groups produced 16 traces / 52,850 notifications;
  its aggregate coverage report has 74 trace-observed identities and 72 identities with ledger events. All traces
  reached phase 5 with zero warnings, masked-state leaks or audit failures.
- `npm run verify` now provides the single low-CPU, no-listen acceptance command; it runs tests, syntax,
  strict typecheck and the default 6-seed × 2-perspective audit sequentially, with hard failure on warnings,
  masked leaks, simulator errors or non-terminal traces.
- syntax check: 30 TypeScript/JavaScript files passed;
- project boundary check: 31 runtime/test/config files scanned; no old robot, LumiTracker, RL or action-control
  dependency was found in the forbidden runtime surfaces;
- strict `tsc --noEmit`: passed with Node type definitions;
- 6 seeds × 2 public perspectives: 12 traces, 34,896 notifications total, all with zero simulator
  errors, zero masked-state leaks and zero masked-snapshot leaks;
- all dynamic traces preserve terminal phase and exposed card-transition ledger counts;
- local `/api/ingest` accepts a notification, rejects immediate reconnect duplicate, and updates the
  dashboard snapshot;
- changing `sessionId` resets the live engine, so a new room cannot inherit the previous room's
  ledger;
- a newly registered page can explicitly replace an old session, while stale reconnect registration
  and delayed ingest from the old page return 409 and cannot reset the new page's ledger; HTTP runtime
  verification passed with page-a/page-b and sequence reset only on the intentional replacement
  (`scripts/server-session-smoke.ts`).
- live runtime defaults to `knownDeck=false` for both sides; the session smoke accepts explicit local and
  simulator opponent deck bindings and resets both on replacement.
- collector flushes the decoder and final partial SSE block when a room stream ends, so an unterminated
  final `data:` event cannot silently drop the last frame.
- one-frame low-load browser fixture with `TRACKER_FIXTURE_UNTERMINATED_LAST=1` still rendered
  `#1 · 初始手牌`; userscript status was `userscript loaded` and no browser warning/error occurred.
- `/bridge/room-sse-collector.js` is served and contains no action-response call.
- dashboard inline JavaScript parses successfully, and a fresh browser dashboard page renders named
  public characters, the active-character marker, HP and energy with no console warnings/errors.
- the page overlay also renders the same public character state; a low-load 256-frame userscript
  fixture reached a live frame with active-character and HP/energy text.
- a 200-frame low-load fixture reached the first public support entity; fresh overlay and dashboard
  pages rendered combat status, support, dice and character state with no fresh dashboard console
  errors. Masked entity definitions remain unnamed.
- ledger audit now treats explicit hand-to-character/support `moveEntity` transitions as played cards
  and ignores `removeEntity` mutations whose `where` is a public combat status/summon/support; all
  12 existing simulator traces still pass: 34,896 notifications, 277 exposed card-transition keys,
  zero tracker warnings, zero masked-state leaks, zero masked-snapshot leaks and zero simulator errors;
  every trace ends at phase 5.
- partial notification frames preserve the previous public side/top-level metadata when fields are
  omitted, while an explicitly empty hand still requires an exposed mutation; duplicate-frame
  warnings are visible immediately in the returned snapshot, and a mutation-only partial frame
  updates the known hand/count from its explicit hand delta.
- partial notifications with no `player` payload still apply exposed `switchActive` and
  `setPlayerFlag` patches, preserving active-character, declared-end and legend-used state.
- non-array mutation payloads are normalized to an empty mutation list instead of crashing the live
  bridge; cross-side hand/pile transfers close the source location as an explicit transfer, subtract
  it from the source deck's remaining count, and avoid a false unknown-exit/play event; public status
  creation/definition transforms do not enter the card ledger unless they are known to belong to a card
  zone.
- upstream `EQUIP_OVERRIDDEN` and `CREATE_SUPPORT_OVERRIDDEN` hand removals are classified as consumed
  plays, with numeric and enum-style reason spellings covered by the engine and audit script.
- replay snapshots are cached per perspective after the first `/api/state` request, so a dashboard
  polling replay mode does not re-read and re-run the large JSONL trace every second.
- two additional unseen simulator seeds (20260719 and 20260720, both public perspectives) produced
  four new traces and 11,270 notifications; all reached terminal phase 5 with zero simulator errors,
  zero masked-state leaks and zero tracker warnings.
- browser-loaded local SSE fixture smoke passed: `collector loaded`, no browser warning/error logs,
  live session `http://127.0.0.1:8899:42:p0`, snapshot sequence 241, phase 3, round 1, warnings 0.
- the same browser fixture now renders the `雨酱牌记牌器` overlay with `#241 / 第1回合 / 行动 /
  视角0`; the shell remains game-safe and the inner card content is scrollable, while browser logs
  still contain no warning/error.
- userscript-loader fixture mode passed in the browser: page reported `userscript loaded`, the same
  overlay and snapshot appeared, and the only browser log was the read-only bridge startup info.
- clean single-page userscript fixture mode passed against the full 2,797-notification capture: the
  page reached a dynamic live frame (`#2180`, phase 3, round 5) with public hand/deck counts and
  known local cards; after the bounded SSE stream completed, the overlay retained the last valid
  ledger (`#2601`, terminal phase) and did not replace it with a disconnect message. Browser logs
  contained only the read-only bridge startup info. Two simultaneous same-perspective fixture tabs
  intentionally race for the per-page session; the later page wins and the older page is reset.
- after the overlay diagnostics change, the same userscript fixture briefly showed the connection/retry
  state and then settled back to `#241 / 第1回合 / 行动 / 视角0`; runtime style kept `pointer-events:
  none`, the only browser log remained the bridge startup info, and local state stayed sequence 241 /
  phase 3 / round 1 / zero warnings.
- the overlay long-list fix was verified against the simulator-driven browser fixture with
  `TRACKER_FIXTURE_DECK=harness/decks/standard-a.json`: the region had `scrollHeight=1369` and
  `clientHeight=709`, a real wheel scroll moved `scrollTop` from 0 to 520, and lower deck cards became
  visible. The fixture now supports optional local/opponent deck injection for this UI check.
- full fixture transport was checked separately; bounded fixture mode is available through
  `TRACKER_FIXTURE_LIMIT` because the full replay is about 27 MB.
- `scripts/room-sse-userscript.user.js` is the user-facing loader for Tampermonkey/Violentmonkey;
  it matches both the formal and beta Rain domains, only injects the served read-only collector and
  has no click/action path.
- guarded real-room smoke passed: two temporary guests produced actual `waiting`, `initialized`, and
  one `notification` event; local ingest returned sequence 1 / phase 0 / zero warnings, and cleanup
  returned giveUp 201.
- `scripts/live-acceptance.ts` is the page-level acceptance harness: it distinguishes a real live
  session/first notification from a replay snapshot, polls only the local tracker, and writes ignored
  JSON evidence under `records/live/`.
- The collector now retries a transient local session-registration failure while keeping the authenticated
  SSE open; retries use `replace=false` after the first attempt, while a 409 stale-page takeover aborts
  the old SSE and disables reconnect.
- A Node VM runtime fixture sends `initialized` and `notification` in one SSE chunk while the first local
  session request returns 503; the collector waits, retries, and forwards the notification exactly once.
- Dashboard rendering now escapes character details, side counts and all card-table numeric cells before
  assigning `innerHTML`; the inline script syntax and escaping assertions pass.
- A runtime VM dashboard fixture injects HTML-shaped values into phase, character, card, event and warning
  fields; the rendered output contains escaped text and no executable tags.
- The engine itself rejects malformed state, illegal perspective and non-array mutation fields, so direct
  HTML/vision callers remain fail-closed even when they bypass notification normalization.
- The HTML adapter additionally rejects malformed runtime observations before they reach the engine:
  missing players, primitive entities, malformed public arrays, invalid counts, duplicate card IDs and
  malformed exposed mutation sources cannot be coerced into an empty-hand frame.
- HTML hand/pile counts are bounded at 256 before synthetic unknown entities are allocated; an oversized
  count is rejected fail-closed to prevent malformed page data from causing an unbounded loop or CPU spike.
- Automatically supplied deck payloads are also bounded before `cardMap`: at most 16 character IDs and 256
  card IDs are accepted, so a malformed `initialized.myPlayerInfo.deck` cannot create an unbounded workload.
- HTML public-entity arrays are capped at 256 entries, nested attachments at 8 levels, and exposed mutations
  at 1,024 entries; oversized or excessively deep observations fail closed before recursion or engine work.
- SSE notification normalization also rejects malformed entity arrays before sequence allocation instead of filtering
  them into empty arrays; public character lists are capped at 16 and HP/energy fields remain preserved by the
  stricter normalizer.
- A fresh browser userscript fixture on simulator seed 20260719 reached live `sequence=299`, phase 3 and zero
  snapshot warnings with a bound 30-card deck; actual wheel scrolling moved the overlay to `scrollTop≈520`.
  The fixture's GM shim now forwards POST method/headers/body, so this browser result exercises session and ingest,
  not just collector injection.
- The independent robot-project public-browser driver created real Rain rooms 7737 and 1363. Room 1363 reached one
  page-owned `switchHands` response before a renderer stall; room 7737 stalled in Node-owned mode. Both remote rooms
  ended in `finished` state after the bounded run; that foreign driver does not retain guest tokens for `giveUp`, so
  this is recorded as renderer-boundary evidence, not as a claim of explicit room cleanup or Tampermonkey success.
- `TrackerEngine.apply()` returns a recursively frozen snapshot; caller-side edits to hand counts or
  warnings fail instead of mutating the engine's internal state, without cloning the full snapshot per frame.
- `npm run stress` now provides a second, strategy-diverse local gate. The default run passed with 12
  games, 24 traces, 80,566 notifications and 544 exposed transition keys; deterministic pre-shuffling
  and seeded random decisions make repeated seed/policy traces byte-identical, and the opponent mutation
  mask remained clean.
- A stress-only exact-mutation leak was found and fixed: nonzero opponent hand/pile definitions in
  simulator mutation payloads no longer create named opponent hand cards. The regression is now 36/36,
  and the default stress run passes with zero masked-snapshot leaks.
- Dynamic audit also reconciles every explicit public hand/pile array with the corresponding snapshot
  quantity; baseline and stress matrices both passed this count invariant.
- The latest stress aggregate reports `played=636`, `discarded=4`, `tuned=118`, `transferred=0`; transfer
  is not emitted by the current pinned policies but has dedicated cross-side regression coverage.
- The stress policy now includes deterministic random selection for switch-hands, reroll, select-card,
  choose-active and action requests; the default stress gate repeats the first random pair and compares
  both perspective SHA-256 values before auditing it.
- Local tuning/discard and hand-to-pile/pile-to-hand regressions are now explicit; these transitions are
  checked without consuming a card twice or turning a private zone event into a guessed public identity.
- HTML observations now use disjoint synthetic IDs for hand and pile cards when the page exposes no entity
  ID; a collision found by code audit was fixed and covered by a dedicated hand/pile regression.
- The HTML contract now carries explicitly visible combat statuses, summons, supports, dice and player flags,
  so the DOM fallback reaches the same public-state fields as the SSE path without inventing hidden identity.
- An independent 3-seed/5-policy random-heavy run (30 perspective traces, 103,156 notifications and 627
  transitions) also passed with zero warnings, simulator errors, masked leaks or count mismatches.
- after the cross-side/status/reason/partial-state ledger fixes, the complete 6-seed x 2-perspective matrix was re-audited:
  12 traces, 34,896 notifications, 277 exposed transition keys, zero warnings, zero masked-state
  leaks, zero simulator errors, and terminal phase 5 on every trace.
- Latest real-driver recheck used the previously working split from the independent robot project: page-driven host
  `run-browser-simulator` with page-owned response plus pure-SSE opponent `run-simulator`, bounded to three requests.
  Room 5591 recorded one host `switchHands` request/response before the opponent hit the known reroll renderer boundary;
  the room subsequently became `finished`. This is real action/renderer evidence, not evidence that the tracker should
  send actions, and it does not promote the pure-SSE opponent path.
- Latest local mechanism recheck used `mechanism-scorpion-a.json` from both perspectives and reached phase 5 at
  sequences 3,748 and 3,747. Both audits had zero errors/warnings/masked leaks; the six representative complex-card
  rows all resolved to catalog images. `npm run verify` remains green at 48/48 tests, 12 traces, 34,896 notifications
  and 277 transitions.
- Latest browser regression reused a simulator-driven `generated-only-a.json` SSE fixture with userscript mode. The actual
  page showed all four ledger sections, loaded 45/45 card images, and kept its 2,758px scroll region at the bottom after
  3.8s of state refresh (`clientHeight=645`, `scrollTop=2113`). The temporary room was closed and 127.0.0.1:8787 health
  returned `ok: true`; this is direct evidence for the clipped/non-scrollable overlay fix.

## Current boundary

The collector has now been run against an authenticated real room through the guarded smoke harness,
and the installed Tampermonkey userscript has also been observed in tracker-owned room 6349. The actual
room page displayed `雨酱牌记牌器`; `/api/health` exposed its live session and live acceptance recorded
sequence 38 / terminal phase 5 / zero tracker warnings. The page was an observer view, so do not turn
this into a claim that the tracker can submit actions or that Rain's renderer is fully automation-ready.
Keep direct-SSE, real-page transport, and action/renderer evidence as separate claims.

The Chrome profile currently exposes real Rain pages, including room 7999 inspected on 2026-07-15:
the page rendered the board, public characters, visible cards, dice and turn state, but exposed no
`data-gi` markers and had no tracker overlay. Keep this as real visual-boundary evidence only, not as
the live userscript gate; the room was already in a waiting/declared-end state and no extension was
installed by the harness.

The fresh 2026-07-16 page-level capture used tracker-owned room 6349 and is recorded under ignored
`records/live/real-browser-room-20260716-acceptance.json`. The historical room 7999/8158 probes still
remain only visual-boundary evidence; they are not substituted for the new live capture.

Latest bounded recheck: tracker-owned room 2897 used standard-a decks, the installed Tampermonkey page and two
external pybinding `VariedPlayer` drivers. The collector accepted 31 live frames with zero tracker warnings, but the
remote game failed during reroll before any card play; the ledgers correctly stayed empty. The room was explicitly
cleaned with host `giveUp` HTTP 201, temporary credentials were deleted, and the tracker was restarted cleanly. Do
not promote this failure to a tracker ledger defect; use the local complex-deck acceptance below for card-event coverage.

The local complex-deck acceptance on 2026-07-16/17 reached terminal phase 5 from both perspectives and verified
catalog-backed rows/images for `草与智慧` (331804), `以极限之名` (332044), `赤王陵` (321020), `噬骸能量块` (124051),
`夜域赐礼·索报皆偿` (217091) and `亡雷凝蓄` (224051), including played, discarded, transferred and generated-pile
paths. This remains mechanism/branch evidence, not a claim that every catalog card and every conditional branch is
fully proven.

Latest simulator-driven coverage recheck (2026-07-16): `coverage-blessing` ran 8 blessing scenarios / 16 games and
`coverage-remaining` ran the countdown-dispose, Lepine-Pauline mega-plan and Tower-of-Ipsissimus adventure scenarios;
all dual-perspective traces reached phase 5 and passed audit. The fixed evidence includes `332032 -> 332033 -> 332034
-> 332035`, `322033 -> 302230 -> 302224`, and adventure thresholds generating `301038` and `301039`.
The current aggregate is `records/coverage/card-coverage-aggregate-20260820.json`: 586 catalog cards, 570 observed,
565 with ledger events, 996 traces, 4,179,067 notifications and no missing trace files. The 16 unobserved IDs are all
historical/runtime-missing; this remains path coverage, not a claim that all effects of every card are formally proven.
`npm test` is 50/50; `npm run verify` and `npm run stress` are green. The new simulator policy supports ordered target
cards and target-card elemental tuning; tuning remains distinct from discard and does not trigger `onDispose`.

## Continue here

```bash
cd /Users/sjm/play/genshincard/gi-tcg-tracker
GITCG_UPSTREAM_ROOT=../genius-invokation npm run export-catalog
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_SIMULATOR_GAMES=4 \
  TRACKER_SIMULATOR_SEED=20260715 npm run simulate
```

Read `PROJECT_STATE.md`, `DECISIONS.md`, `TEST_MATRIX.md`, `RUNBOOK.md` and `WORKLOG.md` before
changing architecture. Never import or copy `../gi-tcg-robot` harness files.

## Latest live simulator evidence (2026-07-17)

`npm run live-simulator` is now the preferred local end-to-end transport check when the user asks for
actual simulator-driven verification. With seed `20260730`, standard-a/standard-b decks and cards/skills
policies, both deck-bound live sessions reached phase 5 with zero warnings. Live projections matched the
offline replay of the exact p0/p1 traces (`sameProjection=true`); live sequence differences are expected
because duplicate notification frames are suppressed. This harness is read-only and does not prove action
control or real-client vision.

## Latest real-room evidence (2026-07-17)

`real-room-smoke` now derives perspective from `initialized.who`, sends both initialized deck payloads
to `/api/session`, and heartbeats while a room waits. Room 1425 proved p0/sequence 1/phase 0,
`ownKnownDeck=true`, `opponentKnownDeck=true`, zero warnings and cleanup 201. A separate room 3852
was observed through 8 real frames to phase 1 with 38/38 card images and zero tracker warnings; its
external MinimalPlayer stopped before card play and is recorded only as a driver/render boundary.
