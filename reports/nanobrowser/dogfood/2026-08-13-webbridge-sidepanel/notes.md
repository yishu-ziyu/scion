# WebBridge 第五步探测（2026-08-13）

**会话：** `chijie-dogfood-sidepanel`  
**标签组：** 持节原生侧栏短测  
**控制面：** Kimi WebBridge `http://127.0.0.1:10086`（本轮自行 `kimi-webbridge start`，未 stop/restart）  
**未做：** `chrome-cdp repair`、未杀 PID 55713、未 `close_session`

## 能看见什么

- 已打开 `https://example.com/`（tabId `261881051`），组名「持节原生侧栏短测」。
- 截图：`01-example-com.png` — 仅网页正文（Example Domain / Learn more），**没有**持节任务卡、收据、暂停/继续/停止。
- `snapshot` 无 `goal-input` / `task-status`。`evaluate`：`hasGoalInput=false`，`hasTaskStatus=false`，页面内 0 个 button/iframe。
- 树末尾 `@e2`/`@e3` 是 WebBridge 自身叠层（截图像素近空白灰块，DOM 中不存在），不是持节侧栏。

## 看不见什么（阻断）

| 尝试 | 结果 |
| --- | --- |
| `list_tabs` | 只返回本会话标签，即 example.com |
| `find_tab` `active:true` + example.com | 用户当时不在看该页 |
| `find_tab` `active:true` + `https://my.feishu.cn/` | 用户当时不在看飞书 |
| `cdp` `Target.getTargets` | `Not allowed` |
| `navigate` `chrome-extension://pdabbpgmohiegdnpooefoedambmcimaii/side-panel/index.html` | Cannot access a chrome-extension:// URL of different extension |
| 另两个历史扩展 ID 的 side-panel URL | 同上 |
| `navigate` `chrome://extensions` | Cannot access a chrome:// URL |

结论：WebBridge 只能驱动**网页标签**。持节原生 Side Panel 是 `chrome.sidePanel` 表面，不是网页，也不是 WebBridge 扩展自己的 `chrome-extension://` 页。因此第五步 7 项全部 **BLOCKED**，不能把网页正文当成侧栏验收。

## 七项

1. 简单读取 — BLOCKED（看不到侧栏任务输入/收据）
2. 中等导航 — BLOCKED（能看见 example.com 链接，但不能从侧栏发任务或读任务卡）
3. 长任务 — BLOCKED
4. 商品任务 — BLOCKED
5. 新对话 — BLOCKED
6. 暂停/继续/停止 — BLOCKED
7. 430/320/200%/键盘/VoiceOver — BLOCKED（cannot observe）

未改产品代码。未把任何 DF-P0 标成 DONE。未进入 E。
