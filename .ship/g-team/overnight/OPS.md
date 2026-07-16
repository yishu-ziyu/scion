# Overnight ops — agentic-ops × G 四线 × gnhf × Matt 证据

## Human time

- **Start:** 已完成（Goal=Tabbit 级插件能力；登录/CDP 已备；睡到明早）
- **Middle:** 无人值守；G1 3 分钟心跳 + gnhf 长循环
- **End:** 明早风险验收 → `MORNING.md`

## 四线（agentic-ops 编排，G1 总线）

| 线 | surface | 职责 | 写 | 证据 |
|----|---------|------|-----|------|
| G1 | 63 | 调度 / 心跳 / 收口 / LIVE | 板 + overnight/* | 心跳日志 |
| G2 | 66 | 规格 contract | docs only | handoffs/G2-* |
| G3 | 65 | 实现+单测 | chijie-browser | handoffs + 测试 exit |
| G4 | 64 | 独立证伪 | reports only | PASS/FAIL 路径 |

**规则：** 派→ACK→做→HANDOFF→G1 写板→再派。禁 W\*。横向不互派。

## gnhf（长循环）

- 目标须可观察 stop-when
- 有 max-iterations 帽
- worktree 防与主树撞写（G3 在主树时 gnhf 用 worktree）
- 迭代笔记：`reports/nanobrowser/overnight/gnhf-notes.md`

## Matt 证据标准（完成才算完成）

| 声称 | 必须有 |
|------|--------|
| 测试过 | 命令 + exit 0 + 摘要路径 |
| 真站旅程 | 页证 / 截图 / golden 矩阵行；0 假完成；批前 0 提交 |
| 实现完成 | HANDOFF files= + G4 独立复跑或 G1 抽检 |
| 阻塞 | 分类（login_wall / engine_start_fail / approval_timeout…）诚实写盘 |

Grok「做完了」不算完成。

## 3 分钟心跳

Session scheduler `3m` → 读 OVERNIGHT_RUN → 查进程 → 收 handoff → 重派/重启 gnhf → 写 HEARTBEAT.md。

## CDP

`http://127.0.0.1:9222` · 不 launch 新 Chrome · 扩展 `ndgepamohiegdnpooefoedambmcimaii`
