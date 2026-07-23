---
title: "G1–G4 名册与指挥链（cmux）"
status: current
updated: "2026-07-16"
workspace: "workspace:9"
---

# G-Team 名册与互通（持节 / scion）

## 六席名册（2026-07-16 扩编 · 握手完成）

| 代号 | 角色 | surface（当时） | 写 | 禁 |
|------|------|-----------------|----|----|
| G1 | 主裁 Intent | surface:63 | 问题/优先级/调度/派工 | 大段业务码 |
| G2 | 规格 Spec | surface:66 | 合同/语义/验收 | 写业务实现；指挥他人 |
| G3 | 实现 Build | surface:65 | 冻结合同内代码+测 | 改合同；自验自过 |
| G4 | 证伪 Prove | surface:64 | 证据/exit/检查表 | 改实现冒充 PASS |
| G5 | 运维 Deploy | surface:75 | 测环境/端口/compose/配置归属/联调清单 | 写业务逻辑 |
| G6 | 体验 Experience | surface:74 | 用户路径/质感/截图验收 | 大改架构不经 G1 |

- workspace 改名：`六席 · Intent→Ship`
- 握手 READY：G2 / G3 / G4 / G5 / G6 均已回执


## 硬边界

| 想当然 | 实际 |
|--------|------|
| 四窗自动知道彼此在聊什么 | **否**。各 surface 是独立 LLM 会话 |
| cmux 合并 context | **否**。cmux 连的是终端/布局 |
| 互通靠「感觉」 | **否**。靠 `tree` 寻址 + `send`/`read-screen` + **盘上文件** |

## 当前名册（编号会变，每次调度前 `cmux tree --workspace workspace:9`）

| 代号 | 角色 | 主环 | surface（启动时） | 写 | 禁 |
|------|------|------|-------------------|----|----|
| **G1** | 主裁 / Leader | L2（触 L3） | `surface:63` | 问题、优先级、LIVE 进度、调度 | 大段业务码；不让下游互下单 |
| **G2** | 规格 | L2→L1 | `surface:66` | contract / evals / docs | 写业务实现；指挥 G3/G4 |
| **G3** | 实现 | L1 | `surface:65` | `projects/chijie-browser` 码+测 | 改合同；指挥他人 |
| **G4** | 证伪 | L1→L2 | `surface:64` | 证据报告 | 改实现冒充通过；指挥他人 |

**禁止：** 触碰任何 **W\*** 窗（另一协作台）。

项目根：`/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion`

## 指挥链（谁可以吩咐谁）

```text
用户
  └─ 只对 G1 说话
       G1（唯一指挥官）
         ├─ send → G2（写/改合同）
         ├─ send → G3（按冻结合同实现）
         └─ send → G4（按合同证伪）
```

| 谁 | 可以吩咐 | 不可以 |
|----|----------|--------|
| **用户** | 只吩咐 **G1** | 不直派 G2–G4（除非你明确 bypass） |
| **G1** | G2 / G3 / G4 | 不得默认假设他们已读彼此聊天 |
| **G2** | 无人（只回 G1 + 写盘） | 不得 `send` 给 G3「按我的想法改」 |
| **G3** | 无人 | 不得改合同、不得派 G4 验收自己 |
| **G4** | 无人 | 不得直接改码当 PASS |

**横向：** G2/G3/G4 **不互下命令**。需要对方产物 → 写盘 handoff → 由 **G1 读后转发绝对路径**。

## 互通怎么做到（cmux 原语）

```bash
# 1) 认路（每次调度前）
cmux tree --workspace workspace:9
cmux identify   # 我是谁

# 2) 看对方在干什么（收回成果的主手段）
cmux read-screen --surface surface:N --lines 80

# 3) 下命令（必须能提交：正文后 \n；多行粘贴后再单独 send \n）
cmux send --surface surface:N "任务…\n"

# 4) 可见状态（可选）
cmux set-status progress "G3 implementing 010" --workspace workspace:9
cmux notify --surface surface:N --title "G1" --body "contract 就绪可开工"
```

**G1 操作纪律：**

1. `tree` 刷新 surface，禁止死记过期编号  
2. `send` 后 `read-screen` 确认已进入 Waiting/Responding，否则补 `\n`  
3. 任务正文必须含：**角色、绝对路径合同、只做项、回传格式、禁项**  
4. 终态以**盘上 handoff / 证据文件**为准，不以对方口头「做完了」为准  

## 握手（互认，不是共享记忆）

每人开场或换任务前一行：

```text
ACK|G?|surface:N|cwd=…|task=…|r/w=…|handoff=surface:63|roster=G1:63 G2:66 G3:65 G4:64
```

- 必须带 **roster**（四人格地址），这样「认识彼此」= 知道该听谁、成果交给谁  
- `handoff` 一律指向 **G1**（`surface:63`，以 tree 为准）  
- 看到别人 ACK 只记名册；**不**假设读过对方全文聊天  

## 一轮指挥（G1 剧本）

```text
1. 钉问题 → 写/更新 LIVE 一行
2. send G2：写冻结合同 path；收 ACK + 文件存在
3. read-screen G2 或读盘 → 判断合同是否可执行
4. send G3：只实现该 contract；收 HANDOFF
5. read-screen G3 + 抽查 diff → 判断是否可验
6. send G4：只读 contract + 跑 evals；收 PASS/FAIL 证据 path
7. G1 判断：
     PASS → LIVE 写通过 + 下一刀或停
     FAIL → 升 contract 版本 或 退回 G3（同一版本补洞）
     BLOCKED → 写阻塞原因，问用户（仅产品方向）
```

### 何时收回成果

| 时机 | 动作 |
|------|------|
| send 后 30–60s | `read-screen`：是否真在跑（非卡在 Paste/Enter） |
| 对方报 Worked for / idle | 读盘 handoff 文件是否存在 |
| G3 声称做完 | 必须有测试命令+exit；G1 可抽查再派 G4 |
| G4 报 PASS | G1 对高风险项可独立复跑一条命令 |

### 收回后 G1 只做三种判断

1. **过** → 记盘、派下一角色或结束  
2. **退回** → 指定谁、哪一版合同、缺哪条 eval  
3. **停/问用户** → 仅当目标或验收标准要改  

## 盘上真相（互认的真正载体）

| 文件 | 谁写 | 用途 |
|------|------|------|
| `docs/product/G-TEAM-ROSTER.md` | G1 | 名册+指挥链（本文） |
| `docs/product/010-three-loop-g1-g4-protocol.md` | G1 | 三层 loop 总协议 |
| `docs/product/dev-contract-*.md` | G2（G1 可代拟后由 G2 确认） | 冻结工作令 |
| `reports/nanobrowser/*-g4-*.md` | G4 | 证伪证据 |
| `docs/product/G-TEAM-LIVE.md` | **仅 G1** | 当前任务状态一行板 |

## HANDOFF 格式（G2/G3/G4 → G1）

```text
HANDOFF|from=G3|task=010-v1|status=delivered|files=…|tests=cmd:0|unverified=…|risks=…
```

G1 确认后更新 `G-TEAM-LIVE.md`，再派下一人。
