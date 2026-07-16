# Test matrix

## Core contract

- known local hand cards are named only from visible non-zero `definitionId`
- opponent masked hand/pile (`definitionId=0`) never becomes a named card
- exact simulator mutation payloads cannot bypass the opponent hand/pile mask; public plays may reveal
  their card identity, but hidden create/draw/tune/discard/transform payloads do not
- played, discarded and elemental-tuning transitions require an exposed mutation
- repeated sequence numbers do not mutate the ledger
- a hand card disappearing without a matching mutation creates an explicit warning
- an omitted hand/pile/player field preserves the last known public fact; an explicitly empty hand
  still creates an explicit warning without a matching mutation
- an imported deck constrains remaining-card counts; an absent deck leaves them unknown
- HTML observations preserve visible local identity but never invent hidden opponent identity
- explicit hand-to-character/support moves count as played cards, while removal of combat statuses,
  summons or supports is not counted as a card transition
- `EVENT_CARD_PLAYED`, `EVENT_CARD_PLAY_NO_EFFECT`, `EQUIP_OVERRIDDEN` and
  `CREATE_SUPPORT_OVERRIDDEN` removals from hand count as played; overflow/other removals remain
  discarded unless the public mutation is insufficient to classify them
- cross-side hand/pile moves close the source location as an explicit transfer, subtract it from the
  source deck's remaining count, and do not invent an unknown exit or a play; public status creation
  and non-card definition transforms do not create card-ledger rows
- public character state keeps names, active-character identity, HP, energy and defeated status in the
  same `TrackerFrame`/snapshot contract;
- partial frames can update active character, declared-end and legend-used flags from their exposed
  `switchActive`/`setPlayerFlag` mutation without requiring a complete `player` payload;
- partial frames can also update phase, round, current-turn and winner from exposed top-level
  mutations, while preserving the previous value when neither state nor mutation supplies a fact;
- public combat statuses, summons, supports, dice and end/legend flags stay in the same snapshot, while
  `definitionId=0` entities remain unnamed;
- malformed runtime HTML observations, missing player tuples, primitive entities, invalid public arrays,
  negative/inconsistent counts, malformed exposed mutation sources and collisions among explicit or synthetic
  hand/pile entity IDs fail closed before they can clear a previous hand or overwrite a location;
- HTML `handCount` and `pileCount` values above 256 are rejected before synthetic entity allocation, protecting
  the low-load bridge from unbounded malformed-page input;
- automatically supplied deck arrays above 16 characters or 256 cards are rejected before ledger construction;
- HTML public-entity arrays above 256 entries, attachment nesting beyond 8 levels, and exposed mutation arrays
  above 1,024 entries are rejected before recursive normalization or engine work;
- notification states containing non-object entity entries or non-array public entity fields are rejected before
  sequencing, so malformed input cannot masquerade as an empty hand/status list;

## Project boundary

- `check-boundaries.ts` scans runtime and test source files for old `gi-tcg-robot`/LumiTracker references;
- runtime surfaces additionally reject pybinding/RL and action-control bridge markers;
- the checker itself is excluded from its own scan, and tests may contain negative assertions for forbidden
  action strings without turning those assertions into runtime dependencies;

## Dynamic simulator matrix

The completed baseline matrix is sequential and low CPU: 6 random seeds, 2 decks, both public
perspectives and two policy modes. The 12 traces contain 34,896 notifications in total; every trace
has zero simulator errors, zero masked-state leaks, zero masked-snapshot leaks, a terminal phase and zero tracker warnings.
Each trace is replayed through the same engine used by the UI, then checked for:

- all observed exposed `moveEntity`/`removeEntity` card transitions, including played, discarded,
  tuned and cross-side transferred counts per physical player/definition;
- no card identity leakage from masked opponent state or exact mutation payloads;
- monotonic frame sequences and terminal frame preservation;
- whenever a notification explicitly contains a hand/pile array, the snapshot hand/deck counts match
  those public array lengths for both players;
- non-empty played/discarded/tuned event coverage where the simulator actually produces them;
- repeated terminal notifications are tolerated, because the upstream game can emit more than one
  `GAME_END` notification for a single game.

## Card breadth inventory

- `npm run coverage` indexes the complete exported catalog and upstream source blocks, including `.gts`
  `define card { ... }` declarations; the exporter must not silently omit those cards.
- The inventory separates `catalog-only` from `trace-observed`; the latter is evidence that a public
  identity appeared, not a claim that every effect branch of that card is covered.
- The inventory also joins the current pinned runtime entity map: `directly-obtainable` means the card can
  appear directly in a constructed deck, `character-deck-obtainable` means a talent/technique card enters
  the deck with its character, `generated-only` means it is produced by an effect, and
  `historical-or-runtime-missing` means the exported catalog has no matching current runtime action entity.
  Runtime totals and catalog intersection totals are reported separately.
- After the catalog parser was extended to `.gts` declarations, the current inventory contains 586
  action-card entries and indexes all 586 source blocks. Existing default traces observe only a subset,
  so this report is intentionally diagnostic rather than a green full-card gate.
- Mechanism-deck traces are kept separate from the standard-deck baseline. A targeted policy may prioritize
  a card set, but every resulting trace is still audited for terminal phase, warnings and masked identity
  leaks through the same engine used by the dashboard.
- `audit-trace` checks the ledger in both directions: each visible played/discarded/tuned/transferred mutation
  must match the engine counter exactly, and every non-zero counter must be explained by a visible mutation;
  this guards against both dropped transitions and invented/double-counted events.
- `npm run coverage-explore` is the bounded sequential orchestrator for these mechanism groups: it uses the
  coverage report's source-signal membership to exclude filler cards from target priority, runs one game per
  selected group, audits both perspectives, and writes an ignored report. It is an exploration harness, not a
  full-card correctness gate.
- `npm run generated-decks` groups `generated-only` character cards by source file and adds source-element reaction
  partners plus explicit target IDs. The resulting generated-character runs are still evidence of exercised public
  paths only; untriggered conditional variants must remain catalog-only.

## Strategy/seed stress matrix

- `npm run stress` runs sequentially and stores traces only in a temporary directory;
- default coverage is 2 new seeds × 6 policy pairs (`random`, `cards`, `skills`, `tuning`, `switch`)
  × 2 public perspectives = 24 audited traces; the random policy makes deterministic choices across
  switch-hands, reroll, select-card, choose-active and action requests;
- the generator pre-shuffles decks deterministically, so repeating a seed/policy pair produces identical
  p0/p1 trace bytes instead of silently relying on process-global `Math.random()`; stress repeats its
  first pair and fails if either SHA-256 differs;
- each trace must have zero simulator errors, zero masked-state leaks, zero masked-snapshot leaks, zero tracker warnings, a terminal
  phase, and matching played/discarded/tuned/transferred counts for every exposed card transition;
- the default stress run currently covers 80,566 notifications, 544 exposed transition keys and all
  observed mutation names (`changePhase`, `createEntity`, `moveEntity`, `removeEntity`, transforms,
  state changes and action-related notifications).
- Its exposed ledger-event coverage is `played=636`, `discarded=4`, `tuned=118`, `transferred=0`; the
  zero transfer count is recorded as “not produced by these simulator policies”, while transfer logic
  remains covered by dedicated unit tests.
- The stress report also prints event counts for each ledger class, so coverage distinguishes zero
  occurrences from an unaccounted occurrence.
- failed stress runs normally clean up their temporary traces; `TRACKER_STRESS_KEEP_FAILURES=1` retains
  the generated evidence directory for forensic inspection.

## HTML adapter

- semantic HTML observation converts to the same `TrackerFrame` contract;
- visible local hand cards are retained, opponent identity is masked, and counts are retained;
- explicitly visible public characters, combat statuses, summons, supports, dice and declared-end/legend
  flags are retained in the same snapshot contract;
- DOM-only hand disappearance becomes an explicit unknown exit rather than a guessed play;
- no mutation is accepted unless it comes from a separately verified exposed event source.

## Room SSE bridge

- split SSE data blocks parse into JSON payloads;
- malformed/non-array mutation payloads fail closed as an empty mutation list rather than crashing
  the ingest path;
- null, array and scalar notification states are rejected before sequencing, so malformed input cannot
  consume a live frame sequence or overwrite a prior snapshot;
- a present-but-non-array notification `state.player` is rejected before sequencing, rather than being
  normalized into an empty player list;
- the engine independently rejects malformed state/player/perspective and treats a non-array mutation field
  as empty, so direct HTML/vision adapters cannot crash or create an illegal snapshot by bypassing normalize;
- stream completion flushes a final partial SSE block before reconnecting;
- reconnect replay of the last BehaviorSubject notification is de-duplicated;
- `OPTIONS /api/ingest` returns 204 and accepted notifications update live `/api/state`;
- changing room/player `sessionId` resets the live ledger;
- after replacement, stale-page registration/ingest is rejected with HTTP 409 and cannot take the live
  ledger back from the new page;
- a room `initialized.myPlayerInfo.deck` and simulator `initialized.oppPlayerInfo.deck` are accepted
  through `/api/session`; they bind the local and opponent diagnostic deck slots for the current perspective;
  the opponent slot is only used for the UI's unplayed-card list and is excluded from real-vision/RL input;
- replay example decks are not reused for live rooms; `TRACKER_LIVE_DECK0/1` remains only an explicit
  test/fallback override when no page-provided deck is available;
- replay snapshots are loaded and replayed once per perspective, then served from memory to the
  dashboard polling loop;
- `/api/state?perspective=1` never falls back to a p0 replay; it selects a matching `-p1.jsonl` trace
  or returns an empty warning snapshot when no p1 replay exists;
- collector `initialized` registers a unique page session before state polling; a new page instance
  resets the live ledger and `/api/state` remains fail-closed until its first notification;
- if SSE stays connected while the local tracker is started late, the collector retries session
  registration at a bounded 1-second interval; a 409 takeover stops that retry instead of stealing
  another page's session, aborts the stale SSE and disables reconnect;
- bridge source contains no action-response or board-click call;
- userscript package contains the expected Rain-room match, localhost permission and collector URL,
  and contains no action-response, click or form-submit call;
- repeated page-stream `tapUnavailable`/`tapError` payloads start at most one direct-SSE fallback;
- the page-stream queue is bounded at 256 entries but retains the latest `initialized` payload under
  burst pressure, so delayed collector startup cannot lose perspective/deck binding;
- overlay and dashboard render local played cards, current local-deck cards, publicly confirmed opponent
  plays and simulator-only opponent-unplayed cards; each rendered card carries a validated static-data
  card-face image URL and a count;
- a locally visible generated pile card whose `deckCount` is unknown is still exposed with `pileCount`, card
  image and count in the local-deck list;
- when no live deck is imported, the local-deck list falls back to currently visible local pile identities;
  hidden or unknown identities remain omitted rather than guessed;
- dashboard inline script is parsed as JavaScript before browser execution, preventing template-string
  escaping regressions;
- dashboard character details, side counts and card-table cells are escaped before HTML insertion, so an
  unexpected string in a live payload cannot become dashboard markup;
- a runtime dashboard VM fixture injects HTML-shaped strings into public snapshot fields and verifies that
  no executable tag reaches rendered `innerHTML`;
- page collector overlay is read-only and action-free: the outer shell remains `pointer-events:none`,
  while its bounded card-content region is the only `pointer-events:auto` scroll surface; it polls the
  local snapshot at a bounded 1.5-second rate and contains no action-response, click or form-submit call;
- when the fixture injects `harness/decks/standard-a.json`, the long overlay list has a bounded region
  (`scrollHeight=1369`, `clientHeight=709`) and a real wheel event changes `scrollTop` from 0 to 520;
- local browser-loaded room fixture reaches live `/api/state` with `sequence=241`, `phase=3`,
  `roundNumber=1`, `warnings=0`, and no browser warning/error logs; the lower sequence reflects
  duplicate-notification suppression;
- the same fixture renders a visible `雨酱牌记牌器` overlay showing frame/round/phase/perspective;
  overlay shell remains `pointer-events:none` and therefore does not intercept game input; only the
  card-content region accepts wheel/touch scrolling so a long four-section list remains readable;
- overlay is present before SSE initialization and exposes connection/retry/local-tracker failures as
  visible text; it returns to the ledger view after a valid snapshot arrives;
- fixture-provided `GM_xmlhttpRequest` shim loads the project userscript source, which then fetches
  and injects the collector; page reports `userscript loaded` and reaches the same live snapshot;
- the userscript fixture forwards GM method/headers/body and, with a 30-card injected deck, reaches live
  `sequence=299`, zero snapshot warnings, card images and a real wheel scroll to `scrollTop≈520`;
- a runtime VM fixture exercises an `initialized + notification` same-chunk sequence with the first local
  session request failing; the collector retries before forwarding and ingests exactly one notification;
- clean single-page full-capture fixture reaches dynamic frames, then retains the last valid ledger
  after the bounded SSE stream completes instead of overwriting it with a disconnect message;
- a second page for the same perspective replaces the first page session and resets its live ledger;
  this is intentional protection against stale room/page state, not a multi-agent game mode;
- guarded real-room smoke created temporary guest players and received `waiting`,
  `initialized(who=0)`, and a real `notification` with `phase=0`/one mutation; forwarding that
  notification into local `/api/ingest` produced `sequence=1`, `phase=0`, `roundNumber=0`, and
  zero warnings; cleanup returned `giveUp` 201 and the room later reported `finished`;
- page-level `live-acceptance` requires both a live session in `/api/health` and a nonzero live
  `/api/state` sequence, so replay-only state cannot pass; its success/failure record is written to
  ignored `records/live/`;
- live sessions expire after bounded inactivity and the collector keeps them alive with a read-only
  heartbeat; server-session smoke covers the heartbeat response and freshness unit tests cover expiry;
- full local SSE fixture remains available for Node/curl transport checks; bounded browser fixtures
  use `TRACKER_FIXTURE_LIMIT` to avoid a ~27 MB replay exceeding the browser transport cap;
- generated-character coverage decks keep `generated-only` cards out of the initial deck while placing
  `character-deck-obtainable` talent/technique cards into it; selected generated deck files are then run
  through both public perspectives and the same ledger audit;
- the latest merged coverage report records trace count, notification count and the remaining taxonomy
  (`character-deck-obtainable`, `generated-only`, `historical-or-runtime-missing`) separately from pass/fail;
- actual userscript installation and capture inside an in-progress Rain room page passed on 2026-07-16:
  tracker-owned room 6349 was opened in the current Chrome profile, the installed Tampermonkey loader
  injected the overlay, and live acceptance recorded `sequence=38`, terminal `phase=5`, and zero tracker
  warnings. The page was an observer view, so this is page transport/overlay evidence, not action-control
  evidence.
- Chrome inspection found a real authenticated beta-domain spectator page; it was already terminal and
  had no overlay, so it is recorded as domain/page evidence but does not satisfy the live userscript gate.
