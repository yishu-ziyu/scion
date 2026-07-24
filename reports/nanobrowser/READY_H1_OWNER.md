# 你只需要做这些（H1）

环境已由 agent 准备：`pnpm build` 完成，ChromeMain CDP 9222 健康，`dist/` 已生成。

## 唯一路径

用 **ChromeMain**（带 CDP 的那只 Chrome，不是 Dia）。

### 若侧栏已有「持节」

1. 点扩展图标打开 **持节** 侧栏  
2. 当前标签停在 **B 站**（已尝试打开 bilibili.com）  
3. 看输入框上方 **「正在读」** 是否显示 bilibili  
4. 发送：`识别当前页面在放什么`  
5. 回 agent：`H1 pass` 或 `H1 fail: …`

### 若没有持节 / 要更新到最新包

1. 地址栏打开 `chrome://extensions`（已尝试打开）  
2. 右上角打开 **开发者模式**  
3. **加载已解压的扩展程序** → 选这个文件夹（Finder 已定位）：

```
/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion/projects/chijie-browser/dist
```

或软链同路径：

```
/Users/mahaoxuan/Projects/chijie-browser/dist
```

4. 若列表里已有旧版持节：点 **重新加载**（圆箭头）  
5. 固定侧栏，回到 B 站标签，按上面 3–5 步

## 不要用

- Sider / OpenClaw 侧栏（那是另一条线，本轮不验）  
- Dia 浏览器  
- 默认无 CDP 的 Chrome 日常配置文件（除非你已手动加载同一 dist）

## 我已替你做完

| 项 | 状态 |
|----|------|
| node / pnpm | OK |
| `pnpm build` → dist | OK v0.1.13 |
| chrome-cdp 9222 ChromeMain | healthy |
| 打开 chrome://extensions | 已尝试 |
| 打开 bilibili.com | 已尝试 |
| Finder 定位 dist | 已尝试 |

你不需要跑终端。
