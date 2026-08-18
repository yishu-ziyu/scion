# Kimi WebBridge 对照实验

Date: 2026-08-18
Daemon: v1.11.5 · extension `fldmhceldgbpfpkbgopacenieobmligc` · port 10086
Host: 美团 Tabbit 里已装 WebBridge，Desktop client connected

## 官方循环（自己跑通）

```
session + group_title
  → navigate / find_tab
  → snapshot（无障碍树，可点节点带 @e）
  → click(@e) / fill / evaluate / screenshot
  → snapshot
  → 把结论写给用户（不要求结论是页面原话）
```

实测：

1. `navigate` example.com，`group_title` =「WebBridge对照实验」→ `list_tabs` 回 `groupTitle`
2. `snapshot` 树里 `Learn more` = `@e1`
3. `screenshot` 写文件，不是 base64
4. `click { selector: "@e1" }` → `{ tag: "A", text: "Learn more" }`
5. `evaluate` → `{ url: "https://www.iana.org/help/example-domains", title: "Example Domains" }`
6. 再截图，页面已是 IANA

截图：`docs/research/webbridge-lab/shots/01-example.png` `03-example-retry.png` `04-after-learn-more.png`

B 站 `navigate` 在 Tabbit 里因扩展每 ~20s 断线超时。循环不依赖站点。

## 和持节要对齐的点

| WebBridge | 持节 |
|-----------|------|
| snapshot → 想 → 写结论 | 曾经要求结论是页面原话（已取消） |
| find_tab / 当前页 | 缺，现补 |
| evaluate 抽标题 | 缺，现补 |
| snapshot 名 | observe 别名 |
| 任务 = 标签组 | 仍无 tabGroups 权限，先不做组 |

没做 1:1 的：network、upload、save_as_pdf、把原始 CDP 交给模型。产品水准靠同一条循环，不靠把 13 个工具名抄全。
