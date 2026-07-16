# GI-TCG Tracker project state

## Objective

独立完成一个面向雨酱牌模拟器的七圣召唤记牌器。当前产品只负责记录和展示信息，不控制
对局，不接 RL，不启动原神客户端。

## Repository boundaries

- 本项目根目录是 `gi-tcg-tracker/`，拥有自己的 `src/`、`test/`、`scripts/`、`harness/` 和
  `records/`。
- `../gi-tcg-robot/` 是另一个已经存在的机器人项目；本项目不 import、不复制、不修改它的
  harness、Agent bridge 或测试记录。
- `../references/LumiTracker/` 是只读参考快照；本项目不依赖其运行时、图片数据库或 Windows
  native code。参考提交记录在 `harness/REFERENCE_NOTES.md`。
- `../genius-invokation/` 只作为 pinned 规则引擎和卡牌数据上游，通过显式环境变量接入。

## Current phase

Phase 3: tracker core + simulator evidence + controlled room bridge + real-page transport acceptance. 已建立 public-information
ledger、牌组输入、JSONL replay、独立 dashboard，并完成 6 个随机种子（20260715–20260720）× 2 个公开视角的
pinned-upstream 动态审计；HTML stub 和只读 room SSE bridge 都落到同一 `TrackerFrame`。
`npm run verify` 还会自动检查 `src/`、`scripts/`、`test/` 的项目边界，防止旧 robot、LumiTracker、RL
或 action-control 运行时依赖混入。
本地 room fixture 已由浏览器页面实际加载 bridge，完成 SSE→`/api/ingest`→live snapshot
闭环；受保护的 real-room smoke 也已从真实 guest 房间接收 authenticated SSE 并送入本地
`/api/ingest`。本地浏览器还实际加载了项目 userscript source（用最小 GM shim）并由它注入
collector/overlay；2026-07-16 又在 tracker 自己创建的进行中房间里用当前 Chrome 的真实
Tampermonkey 完成了页面级 live 采集验证。该验证不扩展为 action-control 或视觉 renderer 成功。

Chrome 现有登录会话里发现了一个真实 beta 域名房间页
(`https://amechan.7shengzhaohuan.online/rooms/7999?player=guest-x7dsgjlic9snsgv525dcoiyj`)；页面能显示真实
观战棋盘和认证用户态，但该房间已经进入等待/宣布结束状态，且页面没有 tracker overlay。因此它证明
正式域名是实际运行入口，不证明 userscript 已安装。userscript 现已同时匹配正式域名和 beta 域名。

collector overlay 现在在 SSE 初始化前也会显示连接/重连状态，便于真实页面诊断 token、SSE
或本地 tracker 不可用；状态刷新频率仍固定为 1.5 秒，没有增加事件流轮询。

dashboard/overlay 现在展示四类牌面：我打出的牌、我牌库中的牌、对手打出的牌、对手未打出的牌；
四类都带卡面图像和数量。对手未打出的牌只在模拟器提供 `oppPlayerInfo.deck` 时计算，真实视觉
模式没有完整对手牌组时明确显示不可用，不进入 RL 观测契约。

2026-07-16 的真实浏览器回归发现并修复了长列表“能滚动但很快回到顶部”的问题：SSE 重连重新收到
`initialized` 时 collector 原先会删除并重建 overlay，状态轮询又会替换其内容。现在同一页面复用仍连接的
overlay，并在 snapshot 重绘后恢复 `scrollTop`。标准牌组 userscript fixture 的干净页面实际滚轮从 0 滚到
500，等待 3.2 秒后仍为 500；随后可到达底部 1838，再向上回到 1338，四个栏目和 38 张卡图都在，浏览器无新
warning/error。该证据只覆盖模拟器 fixture 的展示滚动，不扩大为视觉识别或真实原神客户端支持。

replay 使用 `TRACKER_DECK0/1` 的示例牌组；真实 Rain live room 会从 `initialized.myPlayerInfo.deck`
自动绑定当前页面用户的牌组。模拟器的 `initialized.oppPlayerInfo.deck` 只用于记牌器的“对手未打出”
诊断列表；真实视觉模式不假设它存在。`TRACKER_LIVE_DECK0/1` 仍保留为无页面 initialized 数据时的
测试/兜底配置，不会把 simulator 示例牌组泄漏到真实房间的 RL 输入。

tracker engine 已覆盖上游 card transition：手牌到角色/支援区的公开 `moveEntity` 会记为已打出，
状态区的 `removeEntity` 不会污染牌账本；部分 notification 缺字段时保留上一份公开事实，replay
snapshot 按 perspective 缓存，避免 dashboard 轮询反复重放大 trace。

HTML/content-script 输入也经过运行时 fail-closed 校验：缺失或错误的 players tuple、非法数量和
重复 hand/pile 实体身份不会被转换为空手牌或覆盖既有位置，而是交给 engine 拒绝。

公开边界现在同时作用于 state 和 mutation：对手 hand/pile 即使 exact simulator mutation 带有非零
`definitionId`，也会被 mask；只有公开打出、公开 board 目标或当前本地玩家自己的牌可以进入身份账本。
审计逐帧检查 opponent `knownHand`，不再只检查原始 state 的 `definitionId=0`。

模拟器 harness 已修正上游初始牌堆洗牌的可重复性：上游 `noShuffle=false` 会调用不受
`randomSeed` 控制的 `Math.random()`，现在由本项目用确定性 LCG 预洗牌并传 `noShuffle=true`；同一
seed/策略组合的 p0/p1 trace SHA-256 可重复。新增的压力矩阵覆盖多种双方策略组合，trace 只写临时目录。
当前默认 stress 为 2 seed × 6 策略组合 × 2 公开视角，即 12 局/24 条 trace；其中包含 seed 驱动的
random 用户决策，并在首组 random pair 上强制比较重复运行的 p0/p1 SHA-256。

最新账本边界修复包括：跨玩家 hand/pile 转移会作为 `transferred` 事件关闭源位置并从源牌库剩余数扣除，
不虚构打出/弃置；非数组 mutation 会被 fail-closed 为空数组，状态区的 create/transform 不会污染牌账本。
46/46 单测和完整 12 trace 矩阵在四类牌列表扩展后重新通过；`npm run verify` 同时通过 syntax、boundary、
typecheck 和 34,896 notifications 的动态审计。

HTML/视觉适配还增加了可执行的资源上限：可见 hand/pile 计数超过 256 会在补齐未知实体之前直接拒绝，
避免异常页面数据触发无界分配或 CPU 飙升；自动绑定的牌组数组也限制为最多 16 个角色和 256 张牌，
公共实体数组限制为 256 个、attachment 深度限制为 8 层、exposed mutation 限制为 1024 条，
在进入账本计算前拒绝超大 payload；这些边界已纳入 46/46 单测和完整 verify。

notification 规范化层也不再把 malformed entity 数组过滤成空数组：非对象实体、超大/过深 attachment、
超大 public entity 数组或超过 16 个角色都会整帧拒绝且不消耗 sequence；角色的 HP、能量等公开字段仍被保留。
这组回归当时使单测总数为 47/47；随后 heartbeat/freshness 回归将当前单测总数提升到 48/48。

2026-07-16 使用另一条 simulator trace（seed 20260719）和 userscript loader 做了浏览器复测：
页面显示 `userscript loaded`，成功注册 live session，读取到 `sequence=299 / phase=3 / warnings=0` 的 live
snapshot；30 张牌组的 overlay `scrollTop` 从 0 滚到约 520，底部牌面可见。测试 fixture 的 GM shim 同时修正了
POST method/body 透传，避免把 harness 自身的 GET 404 误判成 tracker 问题。

同日复用独立 `../gi-tcg-robot/scripts/run-public-browser-smoke.ts` 自动创建真实 Rain 临时房间并加入第二玩家：
房间 1363 在页面自提交模式完成 1 次 `switchHands` request/response，随后停在页面 renderer；房间 7737
在 Node 代提交模式停在同一 request。两次均在有界超时后自动停止 simulator/Chrome，远端状态已为
`finished`；该独立脚本没有保留 guest token，因此不能追加 `giveUp`，以后不再把它描述为“清理房间”。
这说明开房、真实页面和 simulator 驱动路径可达，但 Rain renderer 的停滞不能归因于 tracker，也不把它冒充为
userscript gate。

已新增牌库级覆盖审计 `npm run coverage`：它读取上游 `.ts/.gts` 牌定义和当前 trace，区分
`catalog-only` 与 `trace-observed`，并把当前运行时的行动实体标注为可直接构筑或效果生成；当前运行时统计为 571 个行动实体，其中 316 个可直接构筑、255 个效果生成，目录与运行时的交集为 570 个；不会把少量代表牌的通过结果扩大解释为全牌支持。目录导出器现在
同时识别 `card(id)` 和 `.gts define card { id ... }`，避免像 `深渊的呼唤` (332015) 这类牌缺失名称/卡图目录。

新增 `npm run coverage-decks`，可按源码机制从可直接构筑牌中生成 ignored 探索牌组；此前已顺序运行
手牌交换、生成牌堆、回牌、跨手牌转移、弃置/调和、选择、骰子支付和条件分支八组各一局双视角游戏，
共 16 条 trace、54,166 个通知帧，覆盖 74 张实际出现过的牌，其中 73 张产生了账本事件。全部到达
终局，零 simulator error、零隐藏牌泄漏、零 tracker warning；这是机制边界证据，不是 316 张可构筑
牌的全分支正确性证明。

新增 `npm run coverage-explore`，将生成牌组、双视角模拟和审计串成低 CPU 的串行 harness；默认只运行两组，
目标牌从 coverage report 反查，避免把填充牌误算成机制覆盖。任何一侧 audit 失败都会使整个命令失败。
探索器现在还接受 `TRACKER_COVERAGE_EXPLORE_MAX_DECKS`，按每个机制消费多个 `*-NNN.json` 分块，默认仍为 1
以控制 CPU，并在报告中记录 `deckIndex`。2026-07-16 的 N=2 扩展实际运行 10 个分块、20 条 perspective trace、
61,205 条通知，账本事件为 played=504、discarded=69、tuned=65、transferred=9，全部终局且无 warning/隐藏状态泄漏。
另增加了特殊 `direct` 分组，用于消费源码没有机制 signal 但运行时可直接构筑的牌；基础运行 6 个分块、12 条
perspective trace、34,955 条通知，全部终局且 audit-clean。随后用合法的法器角色、枫丹角色组合和定向
`水与正义` 牌组补跑受角色/条件约束的路径；`audit-trace` 也改为对四类账本事件做双向精确校验。
最新合并证据为 59 个牌组分块、118 条 perspective trace、466,513 条通知，账本事件为
played=3,926、discarded=403、tuned=582、transferred=49，全部终局且 audit-clean。
覆盖分类已修正：运行时 155 张是随角色进入牌组的 `character-deck-obtainable` 天赋/特技牌，100 张才是
真正的 `generated-only` 实体。新增的 `generated-decks` 会按角色源码生成 11 个 profile 分块，并按角色
元素注入合法的反应伙伴；2026-07-16 用 skills-first、cards/random、random/random 三种策略各跑了一轮，
共 33 个分块、66 条双视角 trace，全部终局且 audit-clean。牌组 JSON 的 `targets` 会传入模拟器策略，优先
使用后来生成到手牌的目标牌；三轮累计新增观察到多种角色生成身份，但仍不把未触发的条件分支标成已支持。
当前 aggregate（`records/coverage/card-coverage-aggregate-20268000.json`）为 586 张目录牌、378 张
trace-observed、374 张产生账本事件；208 张尚未观察到，其中 150 张是 character-deck-obtainable、42 张是
generated-only、16 张是 historical/runtime-missing。`草与智慧`、`以极限之名`、`赤王陵`、`噬骸能量块`、`亡雷凝蓄`、`夜域赐礼·索报皆偿`
均有实际事件和 card-face URL 证据。`audit-trace` 现在对每个账本行强制检查合法卡图 URL；这仍是路径证据，
不是对所有 586 张牌的全实现正确性宣称。
最近一次默认两组运行产生 4 条 trace、11,626 个通知帧，均到达 phase 5 且无 warning 或隐藏牌泄漏；证据写入
ignored 的 `records/coverage/automated-exploration-20260733.json`。

2026-07-16 又用全部 8 个机制组做了一轮低负载自动探索：16 条双视角 trace、52,850 个通知帧，覆盖手牌交换、
生成牌堆、回牌、跨手牌转移、弃置/调和、选择、骰子支付和条件分支；每条 trace 都到达终局，零 audit failure、
零 warning、零隐藏状态泄漏。对应的 coverage 汇总为 586 个目录牌、74 个 trace-observed、72 个产生账本事件；
报告为 `records/coverage/automated-exploration-20260735-coverage.json`。这个结果仍然只是机制路径证据，不等于
所有牌和所有条件分支都已证明。

同日修复了 overlay 的实际长列表布局：外层使用稳定的 viewport 高度，内部 region 独占滚动并有滚轮兜底；fixture
现在可通过 `TRACKER_FIXTURE_DECK=harness/decks/standard-a.json` 注入模拟器牌组。浏览器实际加载 30 张牌的长列表后，
region 从 `scrollTop=0` 滚到 `520`，`scrollHeight=1369`、`clientHeight=709`，底部牌面可见。

2026-07-15 对真实 Rain-jiang 房间 7999 做了只读页面探针：真实棋盘、回合/轮次、公开角色、可见牌和骰子
均能渲染，但页面没有 `data-gi` 语义标记，也没有 tracker overlay。这确认了正式视觉边界；不把它误报为
userscript 已安装。该历史页面仍只作视觉边界证据。

2026-07-16 随后由 tracker-owned `npm run real-browser-room` 创建临时房间 6349，并将 host 页面 URL
放入当前 Chrome。实际安装的 Tampermonkey loader 注入了 `雨酱牌记牌器`，本地 live session 从 sequence 1
推进到 sequence 38 / phase 5；`npm run live-acceptance` 记录 zero warnings，房间最后由本项目保存的
host 凭证调用 `giveUp` 返回 201。页面是观战视角，两个 simulator agent 只作为外部推进器，故这条证据
证明真实页面采集闭环，不证明 Rain renderer 或 tracker action control。

每个页面实例会在 `initialized` 时先向 `/api/session` 注册唯一 live session；新页面首次注册可
明确接管旧页面，之后旧页面的重连注册和延迟 ingest 都会被拒绝，不能抢回或重置新账本。首条
live notification 到达前 `/api/state` 返回等待快照，不会展示旧 replay。

2026-07-16 验收后补上了 live session 生命周期：server 默认 15 秒无活动后清除 live session、快照、
sequencer 和 deck override，collector 每 5 秒通过只读 heartbeat 保活；可用
`TRACKER_LIVE_SESSION_TIMEOUT_MS` 调整有界超时。当前单测为 48/48，server session smoke 也覆盖 heartbeat。

同日再次用 tracker-owned room 2897、真实 Tampermonkey 页面和两个外部 pybinding `VariedPlayer` 驱动做端到端
复核：collector 接收了 31 个真实 live frame、tracker warning 为 0，但远端对局在重投骰子阶段失败，尚未进入
打牌阶段，因此四类牌账本为空是正确结果。该房间已用 host 凭证 `giveUp` HTTP 201 清理，临时凭据已删除；这
条记录属于远端 driver/renderer 边界，不是 ledger 失败。

随后按独立 robot 项目已经验证过的 split 重新跑了真实 Rain 驱动：host 使用页面驱动的
`run-browser-simulator`，opponent 使用纯 SSE `run-simulator`，页面响应模式开启，最多 3 个请求。临时房间
5591 记录到页面 host 的 `switchHands` request/response，纯 SSE opponent 在同一重投阶段没有 response；两个
驱动和隔离 Chrome 已退出，房间之后自动变为 `finished`。这进一步确认卡点在 Rain renderer/driver 边界，不是
tracker 的四类账本实现。

本地复杂牌组复核随后从两种 public perspective 都到达 phase 5（3748/3747 帧），零 simulator error、零
warning、零隐藏状态泄漏；草与智慧、以极限之名、赤王陵、噬骸能量块、夜域赐礼·索报皆偿、亡雷凝蓄六个目标
牌均有 catalog image URL。全项目 gate 仍为 48/48 测试、12 traces、34896 notifications、277 transitions。

作为可重复的牌账本验收，本地 pinned simulator 的复杂牌组双视角运行均到 phase 5；`草与智慧`、`以极限之名`、
`赤王陵`、`噬骸能量块`、`夜域赐礼·索报皆偿` 和 `亡雷凝蓄` 等目标牌均能得到正确的 played/discarded/transferred/
generated-pile 账本结果，并带 catalog image URL。仍然只代表机制和分支覆盖，不把若干代表牌的通过扩大为全牌
全分支正确性。

## Safety invariant

任何 `definitionId=0`、缺少可见实体身份、未绑定 mutation 或识别置信度不足的牌都只能显示为
未知/部分信息；记牌器不得从 opponent 的 masked hand/pile 推断具体牌名。
