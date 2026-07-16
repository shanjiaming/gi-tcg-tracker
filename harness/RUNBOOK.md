# Runbook

All commands below run from `gi-tcg-tracker/`. They do not start the previous robot harness or a
public simulator room.

## 1. Generate the catalog from pinned upstream

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run export-catalog
```

The generated `data/catalog.json` is ignored and can be regenerated. Names are parsed from the
upstream `@id`/`@name` comments; unknown IDs remain `#id`.

## 2. Generate local simulator evidence

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation \
TRACKER_SIMULATOR_GAMES=2 \
TRACKER_SIMULATOR_SEED=20260715 \
npm run simulate
```

This runs sequential pinned local `Game` instances with one deterministic policy per side and writes
one public-perspective JSONL trace per side under `records/simulator/`. It is intentionally bounded
and CPU-light; it does not open Chrome or use the public server.

## 2.1 牌库级覆盖清单

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
```

该命令读取上游 `packages/data/src`、当前 `data/catalog.json` 和已有 trace，输出
`records/coverage/card-coverage.json`。它会报告目录牌、源码中检测到的机制信号、实际公开 trace
观察到的牌，以及尚未被矩阵触发的牌；同时读取当前运行时实体表，把牌区分为可直接构筑、效果生成
随角色入牌的天赋/特技、效果生成和目录中没有当前运行时实体几类。它是覆盖审计，不会把“目录存在”
或“源码有信号”冒充成效果正确性证明。

可按机制自动生成探索牌组（生成文件在 ignored `records/coverage-decks/`）：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
npm run coverage-decks
```

默认每组最多 15 张不同目标牌、每张两张；不足部分由标准牌组填充。生成的牌组只用于本地探索，
仍需用 `TRACKER_SIMULATOR_TARGET_CARDS` 指定目标并逐局审计，不代表这些牌的所有条件分支都已覆盖。

也可以用低 CPU harness 自动串行完成“生成牌组→模拟→双视角审计”：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
npm run coverage-decks
TRACKER_COVERAGE_EXPLORE_MAX_GROUPS=2 npm run coverage-explore
```

默认只跑前两组，每组一局、两条公开视角 trace，不并发；用
`TRACKER_COVERAGE_EXPLORE_SIGNALS` 和 `TRACKER_COVERAGE_EXPLORE_MAX_GROUPS` 扩展机制范围；
`TRACKER_COVERAGE_EXPLORE_MAX_DECKS` 控制每个机制实际运行多少个生成牌组分块，默认 1。报告写入
ignored 的 `records/coverage/automated-exploration.json`，包含 `deckIndex`，任何一侧 audit 失败都会使整个命令失败。

要单独探索源码没有机制 signal、但运行时可直接构筑的牌，可使用特殊的 `direct` 分组：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_COVERAGE_SIGNALS=direct npm run coverage-decks
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_COVERAGE_EXPLORE_SIGNALS=direct \
  TRACKER_COVERAGE_EXPLORE_MAX_DECKS=99 npm run coverage-explore
```

`direct` 仍然只证明牌进入了这次模拟器公开状态链；它不证明所有牌面条件和目标选择分支。

按角色源码生成生成牌入口的探索牌组：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
GITCG_UPSTREAM_ROOT=../genius-invokation npm run generated-decks
GITCG_UPSTREAM_ROOT=../genius-invokation \
  TRACKER_COVERAGE_DECK_DIR=records/coverage-decks/generated-character \
  TRACKER_COVERAGE_EXPLORE_SIGNALS=generated_character \
  TRACKER_COVERAGE_EXPLORE_MODE0=skills TRACKER_COVERAGE_EXPLORE_MODE1=skills \
  TRACKER_COVERAGE_EXPLORE_MAX_DECKS=99 npm run coverage-explore
```

该 harness 会把牌组 JSON 中的 `targets` 传给模拟器策略，使刚生成到手牌的目标牌优先被使用；它仍然
只提供生成路径证据，不把所有角色条件分支视为已覆盖。当前生成器同时把
`character-deck-obtainable` 的天赋/特技牌放入探索牌组，把 `generated-only` 牌只作为目标事件；
后者不能被错误地伪造为初始牌组内容。

要把当前 aggregate 中尚未观察到的角色天赋/技能牌串行送进 pinned simulator，可运行：

```bash
TRACKER_GENERATED_COVERAGE_MAX_DECKS=999 npm run coverage-generated
```

它会自动选择目标所在的生成牌组，分别记录 p0/p1 公开视角，并对每条 trace 做终局、warning、泄漏和账本双向审计。
需要验证随机技能生成分支时，可用 `TRACKER_GENERATED_COVERAGE_DECKS=<编号>`、
`TRACKER_GENERATED_COVERAGE_EXPECTATIONS=generated-only`、
`TRACKER_GENERATED_COVERAGE_TARGET_CARDS=<id>`，并把 `TRACKER_SIMULATOR_PREFERRED_SKILL_IDS=<skillId>`
传给模拟器驱动；生成牌仍不会被写入初始牌组。

## 3. Replay and inspect

```bash
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run replay
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run web
```

Open `http://127.0.0.1:8787/`. The dashboard is a read-only view; it cannot click the simulator.

## 4. Optional live room bridge

Start `npm run web`, open the rain simulator room in the same browser session, then run this in the
room page context (or package the same file as a userscript/content-script bridge):

```js
window.__GI_TCG_TRACKER_CONFIG__ = {
  endpoint: "http://127.0.0.1:8787/api/ingest",
};
const script = document.createElement("script");
script.src = "http://127.0.0.1:8787/bridge/room-sse-collector.js";
document.head.appendChild(script);
```

The bridge subscribes to the room page's own authenticated notification SSE and mirrors only
`state + mutation`; it does not send action responses or click the board. The local server de-dupes
the replayed last SSE event after reconnect and exposes live state at `/api/state?perspective=0` or
`/api/state?perspective=1`.

The recommended Tampermonkey path is scripts/room-sse-userscript.user.js version 0.3.0. It runs at
document-start, installs a page-context fetch tee for the room notification endpoint, and passes the
tracker a copy of the exact stream already consumed by the Rain page. This avoids a second authenticated
SSE connection. The userscript still owns localhost requests through GM_xmlhttpRequest; the page tee is
read-only and does not touch action-response requests. If Response.body.tee() is unavailable, the collector
falls back to its bounded direct SSE connector and reports that mode in the overlay.

For a real-room page-flow acceptance run (not a production dependency), create a temporary room first:

    TRACKER_ALLOW_REMOTE_ROOM=1 \
    TRACKER_REAL_BROWSER_ROOM_OUT=records/live/real-browser-room-page-tap.json \
    npm run real-browser-room

Start a fresh isolated Chrome with DevTools enabled, then inject the current userscript source before
navigation. The helper only uses the tracker repo and Chrome DevTools; it does not import the old robot:

    TRACKER_REAL_ROOM_CREDENTIALS=records/live/real-browser-room-page-tap.json \
    TRACKER_PAGE_ROLE=host TRACKER_CDP_URL=http://127.0.0.1:9332 \
    npm run prepare-real-page

The acceptance helper is for a test profile where localhost requests are permitted. In a real browser,
Tampermonkey's GM_xmlhttpRequest permission provides that boundary. After preparation, the external
simulator driver may be used to exercise the room, but page renderer/action success must be reported
separately from tracker page-stream/ledger evidence.

For a local browser-loaded bridge smoke, run the tracker and a bounded fixture in separate terminals:

```bash
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run web
TRACKER_FIXTURE_LIMIT=256 npm run fixture -- records/simulator/game-20260715-p0.jsonl
```

For a long-list overlay check that uses a simulator deck rather than an assumed hand-written card list:

```bash
TRACKER_FIXTURE_DECK=harness/decks/standard-a.json TRACKER_FIXTURE_LIMIT=256 \
npm run fixture -- records/simulator/game-20260715-p0.jsonl
```

`TRACKER_FIXTURE_OPPONENT_DECK` can inject a second deck for the simulator-only opponent-unplayed diagnostic.

Then open `http://127.0.0.1:8899/rooms/0042?player=p0` in a real browser runtime. The fixture uses
the bridge defaults (room origin for SSE and `127.0.0.1:8787` for ingest), reports `collector loaded`,
and should produce a live session for `http://127.0.0.1:8899:42:p0`. `TRACKER_FIXTURE_INCLUDE_LAST=1`
is an optional discontinuous terminal-frame stress mode; warnings there are expected because skipped
mutations must remain visible instead of being guessed.

To exercise the userscript loader itself in the browser (the fixture supplies a minimal
`GM_xmlhttpRequest` compatibility shim; it is not Tampermonkey), use:

```bash
TRACKER_FIXTURE_USE_USERSCRIPT=1 TRACKER_FIXTURE_LIMIT=256 \
npm run fixture -- records/simulator/game-20260715-p0.jsonl
```

For a user-facing browser install, import `scripts/room-sse-userscript.user.js` into
Tampermonkey/Violentmonkey. Version `0.3.0` installs the page-owned notification tee, fetches the collector
and proxies the local session/state/ingest requests through `GM_xmlhttpRequest`; this is required when the Rain room is
HTTPS and Chrome blocks page-context access to `http://127.0.0.1`. It injects the same read-only bridge
into matching Rain room pages; it does not grant the tracker any ability to click or submit actions.

If the overlay says `本地 tracker session 不可用：TypeError: Failed to fetch`, replace the installed
userscript with the current `scripts/room-sse-userscript.user.js`, save it in Tampermonkey, and refresh
the room page. The old `0.1.0` loader only used the userscript permission to download the collector;
its injected page script still tried to `fetch` the local API and is incompatible with this Chrome
network policy.

For a guarded real-room smoke, start the local tracker and run:

```bash
TRACKER_ALLOW_REMOTE_ROOM=1 \
TRACKER_REAL_SMOKE_NOTIFICATIONS=1 \
npm run real-room-smoke
```

This creates two temporary guest simulator players using `harness/decks/standard-a.json`, forwards
the first authenticated room notification into local `/api/ingest`, prints the resulting live state,
and calls `giveUp` before exiting. Without `TRACKER_ALLOW_REMOTE_ROOM=1` it performs no network
mutation and exits with a safety message.

### 4.2 Tracker-owned real browser room

When a browser page needs a room that the tracker itself owns, use the separate holder harness:

```bash
TRACKER_ALLOW_REMOTE_ROOM=1 \
TRACKER_REAL_BROWSER_ROOM_OUT=records/live/real-browser-room.json \
npm run real-browser-room
```

It creates and joins the two guest players, writes their short-lived credentials to the ignored output
file, prints the host room URL, and stays alive until SIGINT/SIGTERM. The `finally` path calls the
authenticated host `giveUp`; do not use another repository's room holder for this lifecycle. The
credentials file is test evidence/secrets, not a committed project artifact.

To prove that an actual installed Tampermonkey/Violentmonkey userscript reached the local tracker,
keep the local tracker running, open an in-progress Rain room, import
`scripts/room-sse-userscript.user.js`, and run this in a second terminal:

```bash
TRACKER_LIVE_ACCEPTANCE_PERSPECTIVE=0 \
TRACKER_LIVE_ACCEPTANCE_TIMEOUT_MS=60000 \
npm run live-acceptance
```

The verifier polls only `127.0.0.1`; it succeeds only when `/api/health` reports a live session and a
live snapshot for the requested perspective. A replay snapshot, even one with a large sequence number,
cannot satisfy this gate. On success or timeout it writes a JSON evidence record under the ignored
`records/live/` directory. The evidence is page-level transport evidence, not proof that hidden
opponent state is visible or that the bridge can perform actions.

The local session has a bounded 15-second inactivity expiry and the collector sends a read-only session
heartbeat every 5 seconds. Closing a page or losing the tracker therefore does not leave `/api/health`
reporting a permanent live session; `TRACKER_LIVE_SESSION_TIMEOUT_MS` can raise the timeout for a
deliberately slow environment.

### 4.3 Direct real-room SSE collector

When Chrome navigation or the Rain renderer is stuck on a long-lived page request, the same authenticated
room notification stream can be verified without making the tracker a controller. Keep a room created by
`real-browser-room` alive, start the two external simulator clients, then run:

```bash
TRACKER_REAL_ROOM_CREDENTIALS=records/live/real-browser-room-current.json \
TRACKER_REAL_ROOM_COLLECTOR_TIMEOUT_MS=30000 \
npm run real-room-collector
```

The collector reads only the host credential, registers the `initialized` perspective, automatically binds
`myPlayerInfo.deck` and (when the simulator exposes it) `oppPlayerInfo.deck`, forwards every notification to
`/api/ingest`, and writes a redacted evidence record under `records/live/`. It never calls `actionResponse`,
clicks the board, or imports the old robot project. This is transport/ledger evidence, not page-level
Tampermonkey evidence; use `live-acceptance` for the latter.

On 2026-07-16 the current Chrome/Tampermonkey page was run against tracker-owned room 6349. The page
was an observer view, but the actual userscript injected `雨酱牌记牌器`; the live session reached
sequence 38 / terminal phase 5 with zero tracker warnings. This is page-level userscript/SSE/
ingest/overlay evidence. The observer renderer's inability to submit a response is a separate Rain
page boundary and is not a tracker failure.

## 5. Optional remote tracker host

如果本机压力过高，可以把 tracker 进程放到提供的 `stella.xqm.cloud`，但不要直接把当前无鉴权的
HTTP server 绑定到公网。推荐在远程机上只监听 loopback，再从本机建立 SSH 隧道：

```bash
# stella.xqm.cloud 上
cd /path/to/gi-tcg-tracker
TRACKER_HOST=127.0.0.1 TRACKER_PORT=8787 npm run web

# 本机
ssh -N -L 8787:127.0.0.1:8787 <user>@stella.xqm.cloud
```

浏览器和 userscript 仍使用 `http://127.0.0.1:8787`，但 replay、dashboard 和 ingest 计算在远程机执行。
不要在没有 TLS、认证和访问控制时使用 `TRACKER_HOST=0.0.0.0`。

## 6. Verification

完整的低 CPU、本地、无监听验收入口：

```bash
npm run verify
```

它顺序运行单测、syntax、项目边界检查、strict typecheck 和默认 6 seed × 2 perspective trace audit；需要改变矩阵时可设置
`TRACKER_VERIFY_SEEDS=20260715,20260720`。HTTP session smoke 仍单独运行，因为它需要本机监听权限。

边界检查也可以单独运行：

```bash
npm run check-boundaries
```

它扫描 `src/`、`scripts/` 和 `test/` 的运行时代码，阻止旧 robot/LumiTracker/RL/action-control
依赖进入本项目；测试文件只检查旧项目和 LumiTracker 引用，避免把“断言不存在 action 调用”的字面量
误判成运行时依赖。

```bash
npm test
npm run check
npm run typecheck
npm run audit -- records/simulator/game-20260715-p0.jsonl
```

The live-session takeover smoke starts an ephemeral local HTTP server and therefore may need the
workspace's local-listen permission:

```bash
node --experimental-strip-types scripts/server-session-smoke.ts
```

The dynamic acceptance command uses 6 seeds and both public perspectives:

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation \
TRACKER_SIMULATOR_GAMES=4 \
TRACKER_SIMULATOR_SEED=20260715 \
npm run simulate

for seed in 20260715 20260716 20260717 20260718 20260719 20260720; do
  for perspective in 0 1; do
    npm run audit -- "records/simulator/game-${seed}-p${perspective}.jsonl"
  done
done
```

The broader local strategy/seed stress command is bounded and sequential:

```bash
npm run stress
```

It defaults to `TRACKER_STRESS_SEEDS=20260721,20260722` and
`TRACKER_STRESS_POLICY_PAIRS=random:random;cards:skills;skills:cards;tuning:cards;switch:skills;random:skills`. It generates each
game into a temporary directory, audits both public perspectives, and removes the temporary traces after
the run. Override either environment variable to expand coverage without contacting a remote room. If a
failure needs forensic inspection, set `TRACKER_STRESS_KEEP_FAILURES=1`; the command then prints the
temporary trace directory instead of deleting it.

机制牌组审计可以把 `TRACKER_SIMULATOR_DECK0/1` 指向独立的机制牌组，并用
`TRACKER_SIMULATOR_TARGET_CARDS` 让策略优先尝试这些牌；它仍然是一局一个 agent，运行结果必须
再经过 `npm run audit`，不能只看策略日志：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation \
TRACKER_SIMULATOR_DECK0=harness/decks/mechanism-a.json \
TRACKER_SIMULATOR_DECK1=harness/decks/mechanism-b.json \
TRACKER_SIMULATOR_TARGET_CARDS=331804,332044,321020,332043,332045 \
TRACKER_TRACE_DIR=records/mechanism \
TRACKER_SIMULATOR_GAMES=1 npm run simulate
```

The current acceptance gate is not “the dashboard rendered”. It includes multi-game simulator
traces, masked-information checks, exposed card transitions, repeated frame handling, terminal
frame preservation and warnings for unbound hand exits. Renderer/DOM failures in the future live
adapter must remain explicit input failures; they must not be converted into guessed card identities.

Generated-only branch coverage is driven through the pinned simulator and remains sequential to keep CPU bounded:

```bash
npm run coverage-blessing
npm run coverage-remaining
```

`coverage-blessing` covers both choices for each elemental blessing, including superconduct. `coverage-remaining` covers
the real discard-triggered 幻戏倒计时 chain, the random 乐平波琳 plan that reaches 302224, and the 321033 adventure
thresholds that generate 301038/301039. These commands write ignored JSONL/report evidence and audit the exact trace
paths they just created. To rebuild the aggregate from all retained local traces:

```bash
trace_list=$(find records -type f -name '*.jsonl' | sort | paste -sd, -)
TRACKER_CARD_COVERAGE_TRACES="$trace_list" \
TRACKER_CARD_COVERAGE_OUTPUT=records/coverage/card-coverage-aggregate-20260820.json \
npm run coverage
```

The current aggregate has 570 observed runtime/catalog identities; the remaining 16 are historical/runtime-missing
IDs. This is evidence of reachable paths and ledger transitions, not a blanket claim that every card condition has been
formally exhaustively validated.
