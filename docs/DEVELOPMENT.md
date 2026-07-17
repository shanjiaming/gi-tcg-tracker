# 开发、模拟器验证与真实页面验收

## 本地开发

安装依赖：

```bash
npm install
```

如果要运行上游规则模拟器，请在 tracker 同级目录准备 `genius-invokation`，然后导出当前牌库目录：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run export-catalog
```

启动只读 dashboard：

```bash
npm run web
```

默认地址为 `http://127.0.0.1:8787/`。

## 检查与验收

日常改动至少运行：

```bash
npm test
npm run check
npm run typecheck
npm run check-boundaries
git diff --check
```

完整项目验收：

```bash
npm run verify
```

`verify` 会运行单测、语法检查、边界检查、TypeScript 检查，以及 6 个 seed、双方公开视角的模拟 trace 审计。它不启动浏览器、不监听远程房间，也不会发送 action。

压力矩阵：

```bash
npm run stress
```

## Trace 与 fixture

生成本地模拟 trace：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation \
TRACKER_SIMULATOR_GAMES=4 \
TRACKER_SIMULATOR_SEED=20260715 \
npm run simulate
```

审计 trace：

```bash
npm run audit -- records/simulator/game-20260715-p0.jsonl
```

运行本地 fixture 页面：

```bash
TRACKER_TRACE=records/simulator/game-20260715-p0.jsonl npm run web
npm run fixture -- records/simulator/game-20260715-p0.jsonl
```

然后访问 `http://127.0.0.1:8899/rooms/0042?player=p0`。

## 牌库覆盖探索

查看牌库覆盖报告：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage
```

生成直接构筑牌组：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run coverage-decks
```

生成角色和效果生成牌的探索牌组：

```bash
GITCG_UPSTREAM_ROOT=../genius-invokation npm run generated-decks
```

覆盖报告中的 `trace-observed` 表示牌的身份在公开模拟信息中出现过，不代表该牌的全部费用、目标和条件分支都已验证；`catalog-only` 不能当作“已支持”。

## 真实房间的只读验收

远程房间操作默认关闭。需要明确验证真实 SSE → 本地 tracker 时：

```bash
TRACKER_ALLOW_REMOTE_ROOM=1 \
TRACKER_REAL_SMOKE_NOTIFICATIONS=1 \
npm run real-room-smoke
```

真实页面验收：

```bash
TRACKER_LIVE_ACCEPTANCE_PERSPECTIVE=0 \
TRACKER_LIVE_ACCEPTANCE_TIMEOUT_MS=60000 \
npm run live-acceptance
```

这些命令只验证公开 notification 是否进入本地账本，不提交 action，不证明记牌器可以控制对局，也不证明纯视觉模式已经完成。远程房间凭证只写入被忽略的 `records/live/`，不要提交该目录。

## 发布前检查

发布前确认：

```bash
git status --short
git diff --check
git grep -nE "eyJ[A-Za-z0-9_-]+\\.|ghp_|github_pat_|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE" -- .
```

不要提交 `records/live/`、访问令牌、浏览器凭证或本地绝对路径。
