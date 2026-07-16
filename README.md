# 雨酱牌记牌器

这是一个独立的七圣召唤记牌器项目。它负责把公开可见的对局信息整理成牌账本并展示，
当前不控制对局、不接 RL、不启动原神客户端。

## 当前可运行范围

- 使用 pinned `genius-invokation` 规则引擎生成低 CPU 的本地模拟器 trace；
- 从双方公开视角重放 JSONL 通知；
- 根据可见 mutation 记录打出、弃置、调和、转移、抽牌和回牌；
- 用 `npm run coverage` 生成牌库级覆盖清单，区分目录存在、源码机制信号和实际 trace 观察证据；
- 导入牌组后计算可解释的剩余牌数；
- 对手隐藏手牌/牌堆只保留数量，`definitionId=0` 永远不会被命名；
- 启动一个只读本地 dashboard；
- 提供 fail-closed 的 HTML 语义输入 stub，除了牌区和角色，也可承载明确可见的战斗状态、召唤物、
  支援、骰子和回合标志，供未来 DOM/content-script 或视觉采集接入。
- 提供只读房间 SSE collector，将页面公开 `state + mutation` 推入本地 `/api/ingest`。
- 在雨酱房间右上角显示只读 overlay；它以 1.5 秒低频刷新本地账本，展示我方已打出、我方牌库、
  对手已公开打出和模拟器诊断用的对手未打出四类牌面，并加载对应卡面图像；外层不拦截游戏操作，
  内容区域可滚动查看。

## 快速运行

从本目录执行：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run export-catalog
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_SIMULATOR_GAMES=4 \
  TRACKER_SIMULATOR_SEED=20260715 npm run simulate
npm test
npm run check
npm run audit -- records/simulator/game-20260715-p0.jsonl
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run web
```

单入口的低 CPU 本地验收可以直接运行：

```bash
npm run verify
```

它顺序执行单测、语法检查、项目边界检查、严格 TypeScript 检查和 6 seed × 2 public perspective trace 审计；任一
warning、masked-state leak、simulator error 或非终局 trace 都会失败。它不启动浏览器、不监听端口、
不访问远程房间。

为了覆盖不同的本地游玩策略，还可以运行可重复的压力矩阵：

```bash
npm run stress
```

默认使用 2 个新 seed 和 6 种双方策略组合，共 12 局、24 条视角 trace；生成文件只写入临时目录，
审计后自动删除。策略包含固定的出牌、技能、调和、切换组合，以及 seed 驱动的 `random` 实际游玩组合。
模拟器 harness 会用 seed 控制初始牌堆洗牌和随机决策，避免上游 `Math.random()` 造成结果漂移；每次
stress 默认还会重复第一组 seed/策略并比较 p0/p1 SHA-256。可用 `TRACKER_STRESS_SEEDS` 和
`TRACKER_STRESS_POLICY_PAIRS` 扩展矩阵。

要检查当前到底有多少张牌被实际模拟 trace 观察到，运行：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
```

报告写入被忽略的 `records/coverage/card-coverage.json`。`trace-observed` 只表示该牌的身份曾在
公开模拟信息中出现，不等于该牌的全部效果路径已经证明；`catalog-only` 明确表示当前矩阵没有
触发它，不能被当作“已支持”。报告还读取 pinned 规则运行时：`directly-obtainable` 是可直接构筑的牌，
`character-deck-obtainable` 是随对应角色加入牌组的天赋/特技牌，`generated-only` 是只能由效果生成的牌，
`historical-or-runtime-missing` 是目录中存在但当前运行时未出现的定义；
因此“未被 trace 观察到”不能简单等同于“缺少实现”。

需要按机制做探索时，可先运行 `npm run coverage-decks` 生成 ignored 的小牌组；它只挑选当前运行时
可直接构筑的牌，每张目标牌放两张，不足位置用标准牌组填充。随后用 `TRACKER_SIMULATOR_TARGET_CARDS`
逐组运行本地模拟器并执行 `npm run audit`，这仍是覆盖探索工具，不是全牌效果证明。

天赋/特技牌的运行时 `obtainable=false` 不代表效果生成；它们需要随对应角色进入牌组。可用
`npm run generated-decks` 自动按角色源码生成这类生成入口的探索牌组，并用显式 `targets` 让模拟器策略
优先使用生成到手牌中的目标牌：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
GITCG_UPSTREAM_ROOT=../genius-invokation npm run generated-decks
GITCG_UPSTREAM_ROOT=../genius-invokation \
  TRACKER_COVERAGE_DECK_DIR=records/coverage-decks/generated-character \
  TRACKER_COVERAGE_EXPLORE_SIGNALS=generated_character \
  TRACKER_COVERAGE_EXPLORE_MODE0=skills TRACKER_COVERAGE_EXPLORE_MODE1=skills \
  TRACKER_COVERAGE_EXPLORE_MAX_DECKS=99 npm run coverage-explore
```

该入口仍是生成路径证据，不等于所有角色条件和所有牌面分支都已覆盖。`generated-decks` 会按源码目录给
角色 profile 选择合法的元素反应伙伴；需要扩大策略覆盖时，可用不同 seed 依次运行 `skills/skills`、
`cards/random`、`random/random`，它们仍然串行执行，不会并发控制多局。

也可以运行 `TRACKER_COVERAGE_EXPLORE_MAX_GROUPS=2 npm run coverage-explore`，让 harness 串行完成两组
牌组的模拟和双视角审计；默认每类只跑一个分块牌组，不并发以控制 CPU。要扩大同一机制的分块覆盖，
设置 `TRACKER_COVERAGE_EXPLORE_MAX_DECKS=2`（或更大的明确值）；报告会记录实际跑过的 `deckIndex`，
写入 `records/coverage/automated-exploration.json`。

对于源码没有机制 signal、但运行时允许直接构筑的牌，可以显式生成并探索 `direct` 分组：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_COVERAGE_SIGNALS=direct npm run coverage-decks
GITCG_UPSTREAM_ROOT=../genius-invokation TRACKER_COVERAGE_EXPLORE_SIGNALS=direct \
  TRACKER_COVERAGE_EXPLORE_MAX_DECKS=99 npm run coverage-explore
```

这仍然是“牌被送入模拟器并经过公开状态链”的覆盖证据，不代表每张牌的所有费用、目标和条件分支都已验证。

然后打开 `http://127.0.0.1:8787/`。dashboard 只读，不会点击模拟器。

真实 Rain 房间不需要手动输入牌组码：房间 SSE 的 `initialized.myPlayerInfo.deck` 会被 userscript
自动提交到本地 tracker，并绑定当前 perspective 的实际牌组。模拟器还会提供
`initialized.oppPlayerInfo.deck`，因此 dashboard/overlay 可以额外显示“对手未打出的牌”；这一项
只表示模拟器诊断信息，不能作为真实原神视觉模式或 RL agent 的可用观测。真实视觉模式拿不到
对手完整牌组时，该列表会明确显示不可用。`TRACKER_LIVE_DECK0/1` 仅作为没有页面 initialized
牌组时的本地测试/兜底配置，不会把 simulator 示例牌组泄漏到真实房间。

真实房间（正式域名或 beta 域名）可在房间页上下文加载
`http://127.0.0.1:8787/bridge/room-sse-collector.js`，或将
`scripts/room-sse-userscript.user.js` 导入 Tampermonkey/Violentmonkey；该脚本复用页面自己的
认证，只读订阅 notification SSE，不发送 action。userscript 版本还会通过
`GM_xmlhttpRequest` 代发本地 tracker 的 session/state/ingest 请求，避免 HTTPS 房间页面被浏览器
拦截 `http://127.0.0.1`；详见 `harness/RUNBOOK.md`。

真实房间的低风险连通性 smoke 已经由受保护 harness 验证过：它会临时创建 guest 房间、读取
认证 SSE、把第一条真实 `notification` 推入本地 tracker，然后自动 `giveUp` 清理。默认不开启
远程房间创建；需要显式运行：

```bash
TRACKER_ALLOW_REMOTE_ROOM=1 \
TRACKER_REAL_SMOKE_NOTIFICATIONS=1 \
npm run real-room-smoke
```

这证明了“真实 SSE → 本地记牌器”的链路；页面级 Tampermonkey 验收也已在下方的 tracker-owned
临时房间中完成，但它不等同于记牌器可以控制对局。

项目自己的真实浏览器房间 harness 可以创建并保持一局临时 guest 对局，把凭证写到被忽略的
`records/live/` 文件，并在进程收到 SIGINT/SIGTERM 时用创建者凭证调用 `giveUp`：

```bash
TRACKER_ALLOW_REMOTE_ROOM=1 \
TRACKER_REAL_BROWSER_ROOM_OUT=records/live/real-browser-room.json \
npm run real-browser-room
```

2026-07-16 已用当前 Chrome 中实际安装的 Tampermonkey 在该 harness 创建的房间完成页面级验收：
页面出现 `雨酱牌记牌器`，真实 live session 到达 `sequence=38 / phase=5`，无 tracker warning，
证据为 `records/live/real-browser-room-20260716-acceptance.json`。这证明 userscript + 真实页面
SSE + 本地 ingest + overlay 闭环；该页面处于观战态，不能证明记牌器可以提交动作，记牌器仍然是只读的。

页面级验收可以用本地 live acceptance harness 记录，避免把 replay 误判为真实 userscript：

```bash
TRACKER_LIVE_ACCEPTANCE_PERSPECTIVE=0 \
TRACKER_LIVE_ACCEPTANCE_TIMEOUT_MS=60000 \
npm run live-acceptance
```

它只轮询本地 `/api/health` 和 `/api/state`，必须看到指定视角的 live session 与首条 live
notification 才成功；证据写入被忽略的 `records/live/`。真实页面验收时不要把 replay 快照或
另一个项目的 renderer/action 成功冒充为记牌器证据。

本地页面闭环可以这样跑：

```bash
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run web
TRACKER_FIXTURE_LIMIT=256 npm run fixture -- records/simulator/game-20260715-p0.jsonl
```

然后打开 `http://127.0.0.1:8899/rooms/0042?player=p0`。页面 bridge 会自动连接 fixture 的
SSE 并把通知推入 tracker；`TRACKER_FIXTURE_INCLUDE_LAST=1` 可额外测试跳到终局帧时的
fail-closed 告警。

## 输入边界

所有来源最终都必须产生 `TrackerFrame`：

```text
simulator exact state ─┐
HTML/content script ───┼─> TrackerFrame ─> TrackerEngine ─> dashboard
future vision ─────────┘
```

`src/adapters/html.ts` 的输入只接受页面明确看见的牌和数量。没有实体身份或事件来源时，
它会提交未知牌；手牌消失会生成 `unknownHandExit`，不会猜成“打出”或“弃置”。
同一条规则也适用于 simulator/room mutation：对手 hand/pile 的非零 `definitionId` 不会因为
payload 恰好带出来就进入 tracker；只有公开打出、公开 board 状态或本地玩家自己的牌会保留身份。

## 项目隔离

- `../gi-tcg-robot` 是另一个项目，本项目不 import、复制或修改它的代码和 harness；
- `../references/LumiTracker` 是只读研究快照，不是运行时依赖；
- `../genius-invokation` 只作为显式指定的规则/数据上游。

真实雨酱页面的纯 DOM/视觉采集仍需单独实现。页面对局棋盘是动态 3D DOM，卡牌没有稳定实体
`data-id`；当前已完成的是页面自己的认证 SSE 采集，未来若要摆脱 SSE，视觉层仍必须先通过
fixture 和动态 trace 验证，再接入 dashboard。

当前已验证本地浏览器加载 bridge 后能产生 live snapshot，也已通过受保护 smoke 和 tracker-owned
真实房间页面验证真实 guest 房间的认证 SSE 能进入本地 `/api/ingest`。这不等于纯视觉采集或
动作控制已经完成；不能把页面级 transport 证据扩大成全自动机器人证据。
