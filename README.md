# 雨酱牌记牌器

只读的七圣召唤记牌器：读取雨酱牌模拟器房间公开的对局信息，显示我方牌库、我方已打出、对手已公开打出，以及模拟器专用的对手未打出牌。它不会替玩家点击棋盘，不控制原神客户端，也不调用 RL agent。

## 最快运行

需要：Node.js 22+、Git、Chrome，以及 Tampermonkey 或 Violentmonkey。

```bash
git clone https://github.com/shanjiaming/gi-tcg-tracker.git
cd gi-tcg-tracker
npm install
npm run web
```

保持 `npm run web` 的终端窗口打开，然后：

1. 在脚本管理器中导入并启用 [`scripts/room-sse-userscript.user.js`](scripts/room-sse-userscript.user.js)。
2. 如果 Chrome 提示“请启用允许用户脚本”，在扩展设置中打开 **Allow User Scripts**。
3. 打开或刷新雨酱牌模拟器的对战房间页面，网址应类似 `https://amechan.7shengzhaohuan.online/rooms/...?...player=...`。
4. 房间右上角出现“雨酱牌记牌器”即完成。

## 文档

- [使用说明](docs/USAGE.md)
- [架构、信息边界与衍生牌处理](docs/ARCHITECTURE.md)
- [开发、模拟器验证与真实页面验收](docs/DEVELOPMENT.md)

## License

本项目按 GNU Affero General Public License v3.0 or later 发布，见 [`LICENSE`](LICENSE)。
