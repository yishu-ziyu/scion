# 你只做测试（前置已备好）

更新时间：2026-07-15（持节 UI-1–5 IA 已进 main）

## 你只做这 4 步

1. Chrome 打开 `chrome://extensions`
2. 找到 **持节 / Chijie**（或旧名痕迹）→ 点 **刷新**；Load unpacked 路径必须是下方 `dist`
3. 打开侧栏，在「测试页」里测
4. 把异常用一句话丢回来（页面 + 你发的指令 + 现象）

## 测试页（本机固定端口）

| 用途 | 打开 |
|------|------|
| 目录 | http://127.0.0.1:18765/ |
| 表单（审批） | http://127.0.0.1:18765/form |
| 媒体 | http://127.0.0.1:18765/media |
| 提交次数 | http://127.0.0.1:18765/count （测前可先打开 /reset） |

扩展目录（刷新用）：

```text
/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion/projects/chijie-browser/dist
```

等同：`~/projects/chijie-browser/dist`

## 建议测的两句

**表单**

```text
把表单 Name 填成 BakeoffName，提交前先停下来等我批准；我批准后再提交。成功看到 Saved successfully 再结束。
```

看：批前 `/count` 仍为 0；批准后变为 1；侧栏出现完成回执；文案「批准一次」可见。

**媒体**

```text
播放页面上的音频，然后暂停它。
```

看：能真暂停；侧栏不报假完成；不见 Planner/Navigator。

## 设置页可看

扩展选项 → 默认 **总览**：流水线、执行核 control|nano、审批预览、Skill 配方说明、回执与隐私。

## 已替你做好的

- `pnpm inject:personal` + `pnpm build`（MiniMax 打进扩展）
- 默认执行核 `control`（可换核 G6）
- design/003 UI-1–5 信息架构（侧栏分块 + Options 总览）
- 本地 fixture 服务端口 **18765**
- 密钥不进 git
- 单元：sidepanel 29、chrome-extension 189 均绿

## 不用你做的

- 飞书 / B 站（M3，需你日常登录）
- 改 API Key
- git push
- 改代码
