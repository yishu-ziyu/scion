# Notion 设计系统索引 → 持节侧栏（~430px 任务控制台）

**日期:** 2026-08-12
**用途:** 为 parent 将 Notion 可执行规则映射到 `pages/side-panel/src/design/chijie-tokens.css`
**本地对照:** `chijie-tokens.css`（暖纸 + scion 绿）；产品 IA `docs/design/008-long-horizon-task-progress-console.md`
**范围:** 只读 Notion + 写本报告；未改产品代码
**原则:** 优先用户蒸馏笔记（Apple / Refactoring UI / Sajid / Agentive UX），弱化 Google 课程大纲类页面

---

## 1. 精选 Notion 页面（13 页）

| # | 标题 | URL / ID | 为何对 Agent 任务控制台有用 |
|---|------|----------|---------------------------|
| 1 | Design Principles 设计原则概述 | https://www.notion.so/382886bc60ff8083b3ecfd0522c47ed4 · `382886bc-60ff-8083-b3ec-fd0522c47ed4` | Agency / Feedback / Hierarchy / Stay Out of the Way：对齐 008 三秒理解与随时干预 |
| 2 | Color System and Branding 颜色系统与品牌表达 | https://www.notion.so/380886bc60ff80fcb3bbeaa4bf654d9d · `380886bc-60ff-80fc-b3bb-eaa4bf654d9d` | 颜色克制、accent 仅服务状态与操作；避免信息过载（窄栏关键） |
| 3 | Typography and Fonts 排版与字体 | https://www.notion.so/380886bc60ff8077ad56c00edabbb24a · `380886bc-60ff-8077-ad56-c00edabbb24a` | 可读性优先；系统字重分层；自定义字体要可缩放 |
| 4 | Progress indicators 进度指示器 | https://www.notion.so/217886bc60ff814d9e36c70fa327b08d · `217886bc-60ff-814d-9e36-c70fa327b08d` | 确定型 vs 不确定型；禁止假进度；可中断；文案要具体（对 Gate / Health） |
| 5 | 1 Visibility of System Status 系统状态可见性 | https://www.notion.so/1f8886bc60ff815e9832c576f594c13b · `1f8886bc-60ff-815e-9832-c576f594c13b` | 适量反馈：关键状态持续可见，内部扫描细节不展示 |
| 6 | Establish a spacing and sizing system 建立间距和尺寸系统 | https://www.notion.so/226886bc60ff8136b36bdf20a44dd788 · `226886bc-60ff-8136-b36b-df20a44dd788` | 固定尺度表；相邻档约 ≥25%；小尺寸细、大尺寸粗 |
| 7 | Avoid ambiguous spacing. 避免模糊不清的间距 | https://www.notion.so/226886bc60ff8118a0dafdf98c4a9180 · `226886bc-60ff-8118a0dafdf98c4a9180` | 组间 > 组内；Mission / Now / Health 块边界靠间距 |
| 8 | Color Palettes 调色板 | https://www.notion.so/226886bc60ff81fc90b2fa834b6abcec · `226886bc-60ff-81fc-90b2-fa834b6abcec` | Primary / Neutrals / Supporting 三分法 → 持节 accent / 中性 / 语义色 |
| 9 | Don't rely on color alone 不要仅仅依赖颜色 | https://www.notion.so/226886bc60ff8158b4a5e17a99089c8d · `226886bc-60ff-8158b4a5e17a99089c8d` | 健康态 / Gate 状态必须有文字或图标，不能只靠色点 |
| 10 | The Easy Way to Pick Perfect Spacing 挑选完美间距 | https://www.notion.so/e31886bc60ff83b38843014733f1b871 · `e31886bc-60ff-83b3-8843-014733f1b871` | 以 body 字号为 1rem；阶梯 0.5/0.75/1/1.25/1.5；窄屏别按桌面大留白 |
| 11 | The 80% of UI Design - Typography | https://www.notion.so/f2c886bc60ff8326971f017c9994c30c · `f2c886bc-60ff-8326-971f-017c9994c30c` | 3 档字号 + 字重 + 明度即可；主文 100%、次要 ~60% 明度 |
| 12 | You assist me! 你来协助我！ | https://www.notion.so/1f8886bc60ff81d2bbe1e6aa3f751726 · `1f8886bc-60ff-81d2-bbe1e6aa3f751726` | Handoff / take-back：暂停继续随时可切；AI 不抢主导权；有反馈 |
| 13 | Spacing 间距（Material） | https://www.notion.so/1ff886bc60ff8191b1b5fded13a3f589 · `1ff886bc-60ff-8191-b1b5-fded13a3f589` | 显/隐分组；padding 4dp 步进；窄栏优先隐性分组（邻近）减框线噪音 |

**相关但未全文抓取（索引备用）:**

| 标题 | ID | 备注 |
|------|-----|------|
| Type scale & tokens 字号比例 | `1ff886bc-60ff-810c-8cfcd41fa4c78c90` | Material 15 样式过多；取「减到 5 档、避相近字号」 |
| Agentive UX 代理型体验 | `1f8886bc-60ff-81ec-a94e-ff8f5494e9c1` | 索引页；可执行细则在子页「You assist me!」 |
| Working with Color 色彩运用 | `226886bc-60ff-8125-b4b7-e84ac7916e3c` | 索引；子页 #9 已抓 |
| Layout and Spacing 布局和间距 | `226886bc-60ff-8123-bf40-f8925f0c1389` | 索引；子页 #6/#7 已抓 |
| Shape of AI / AI-UX interactions | 父级索引 | 偏产品模式分类，少具体 token 数值 |

**未优先采用:** Google UX Certificate 课程大纲页、泛 Design Systems 101 介绍（信息密度低、少可执行数值）。

---

## 2. 可执行规则（仅规则，无散文）

### 2.1 层级与信息架构（~430px）

1. 首屏只答六问：目标 / 进度 / 现在做什么 / 健康否 / 已得什么 / 我能做什么（与 008 一致；来源：Design Principles · Hierarchy + Necessary Only）。
2. 界面默认不打扰：用户来做事；辅助信息后置；Logo、动作总数、原始日志不得抢首屏（Design Principles · Stay Out of the Way；对齐 008）。
3. 状态一致且互斥：运行 / 暂停 / 中断 / 需要用户 / 失败不可同时“在干活”（Feedback + 008 审计）。
4. 用户主导权：随时 pause / continue / correct / stop（You assist me! · Take-back and Handoff）。
5. 文案简洁、可行动：避免「加载中」「正在验证」；写具体对象与目的（Progress indicators §6；Design Principles · Concise Language）。

### 2.2 系统状态与反馈

1. 反馈要及时、可见：操作后控件状态变化；长任务有持续状态（Visibility of System Status）。
2. 只显示用户能决策的信息：不展示服务器扫描等内部细节（Visibility §3）。
3. 已知总量 → 确定型进度（Gate current/target）；未知总量 → 不确定型或检查点，**禁止伪造百分比**（Progress indicators §1–2；对齐 008 Gate）。
4. 进度条必须持续动/更新；卡住时解释原因与可选项（Progress §3）。
5. 能从不确定型切到确定型；**不在线性/圆形样式间乱切**（Progress §4–5）。
6. 可中断：无副作用 → Cancel；有进度损失 → Pause + 说明后果（Progress §8；You assist me!）。
7. 状态位置固定：任务状态在 Header/Health 固定位，不在聊天流里漂移（Progress §7；008）。

### 2.3 颜色

1. 三分法：Primary（操作/链接/强调边） / Neutrals（文、底、边、次按钮） / Supporting（错误、成功、警告，克制）（Color Palettes）。
2. 颜色表达意义：层级、分组、交互状态；不铺满装饰（Color System and Branding）。
3. Accent 克制如 Slack：未读/选中/主 CTA/关键状态才上色（Color System）。
4. **禁止只靠颜色传状态**：健康/Gate/错误必须附文字或图标（Don't rely on color alone）。
5. 强对比仅留给：主 CTA、错误、需要用户处理；其余柔和（与本地 DESIGN.md §2.5 一致方向）。
6. 持节现有色轴（已在 CSS，不从 Notion 发明 hex）：
   - 底 `#fbfaf7` · 文 `#1f2d2a` · muted `#687280`
   - accent `#166f4e` · accent-subtle `#eaf4ef`
   - warn `#e6a11a` · danger `#d94a4a` + 对应 subtle

### 2.4 排版

1. 窄栏用少数字号：基准 14 或 16px；全控制台 **3 档字号 + 字重 + 明度** 够用（80% Typography）。
2. 主文 100% 明度/前景色；次要元信息约 60% 相对明度或 `--chijie-muted`（80% Typography）。
3. 避免相邻字号过近；需要区分就拉开或改字重，不堆 15 档 Material 全表（Type scale 笔记）。
4. 行高可用 `1em`～`1.4` 量级；标题行高紧一点可自带“呼吸”而少加 margin（80% Typography）。
5. 字体角色：body 无衬线（Space Grotesk + Noto Sans SC）；mono 给 Gate 数字/时间/审计；hand/serif **侧栏控制台极少用**（避免品牌花活挤密度）。
6. 自定义字体需可换行自适应；不截断关键任务标题（Typography and Fonts · Dynamic Type 精神）。

### 2.5 间距与密度（~430px）

1. 单一尺度表，禁止 13/17 等随意 px（Easy Spacing；Establish spacing system）。
2. 建议阶梯（以 8px unit 或 1rem=16 对齐现有 `--chijie-space-unit`）：`4 / 8 / 12 / 16 / 24 / 32`（= 0.5u…4u；与 0.5–2rem 思路同向）。
3. 相邻尺寸档差约 ≥25% 再选（Establish spacing system）。
4. **组内 < 组间**：块内 4–8px；区块间 16–24px（Avoid ambiguous spacing；Easy Spacing Case2）。
5. 标题与其所属列表：标题上方更大、与列表内项间距更小（Easy Spacing Case1）。
6. 窄栏优先 **隐性分组**（邻近 + 留白）；少用重边框/阴影卡套卡（Material Spacing · Implicit；本地 DESIGN 色块>阴影）。
7. 横向控件（暂停/继续/composer）：相关控件贴紧，危险「停止」与主控件组拉开（Easy Spacing Case2/3 精神）。
8. 不要按 27" 大屏留白设计侧栏；默认偏紧凑，再按尺度表加一档，不加随机像素（Easy Spacing 基础）。

### 2.6 运动（笔记中有限）

1. 状态变化可用短动画帮助理解上下文变化（Design Principles · Preserve Context）。
2. 不确定型进度保持连续动画；停更时改为文案解释，勿假转（Progress indicators）。
3. 愉悦动效不得干扰核心任务信息（Design Principles · Not Decoration）。
4. Notion 笔记 **无** 侧栏具体 duration/easing 数值 → 未发明 token 值。

### 2.7 Agent 协作（产品交互，非视觉 token）

1. AI 是副驾驶：后台推进 + 用户随时接管（You assist me!）。
2. 建议可采纳/可忽略，不静默改用户目标（Waze 类；对齐 008 Mission 稳定）。
3. 需要用户时状态升到首屏最高优先级（Visibility + 008 Health `needs_user`）。

---

## 3. 冲突 / 需 parent 拍板

| ID | 冲突 | 选项 | 建议默认 |
|----|------|------|----------|
| C1 | **品牌 accent** | 本地 DESIGN.md 蜡笔红 vs 持节 scion 绿 `#166f4e` | **保持 scion 绿**（`chijie-tokens` 已定）；红仅作 danger，不作 brand |
| C2 | **明暗默认** | DESIGN.md 工具台偏暖墨暗面 vs 持节现亮暖纸 | 侧栏 **先锁亮暖纸**；暗模式另开 milestone，不半套混用 |
| C3 | **圆角/玻璃** | Apple Liquid Glass / 悬浮栏 vs Chrome 侧栏实底控制台 | **不用 Liquid Glass**；固定 Header + 实底 surface，减透明采样 |
| C4 | **阴影 vs 色块** | Material 阴影分组 vs DESIGN「色块对比 > 阴影」 | **默认无 box-shadow**；用 surface / border / 间距分组 |
| C5 | **字号阶梯** | Material 15 样式 vs Sajid 3 档 vs 现 CSS 无 type token | 新增 **3–5 档** type token，不搬 Material 全表 |
| C6 | **间距单位** | rem 跟系统字号 vs 固定 8px unit | 侧栏扩展里 **继续 8px 倍数 token**；不必强上 rem（扩展字体缩放弱） |
| C7 | **进度形态** | 008：未知总量不伪造 % vs Apple 优先确定型 | 有 Gate 数用确定型；无 target 用里程碑检查点 + indeterminate 小标，**不造总 %** |
| C8 | **密度** | Refactoring「先太多留白再收」vs 430px 控制台 | **直接紧凑档**起步（4/8/12/16），区块间最多 24，禁止大屏卡片呼吸 |
| C9 | **手写/衬线** | 品牌 Gochi/Serif vs 控制台密度 | 控制台 **body+mono 为主**；hand 仅品牌角标若需要 |

---

## 4. 映射表：Notion 规则 → `--chijie-*`

### 4.1 已有 token（直接用）

| Notion 规则 | 现有 token | 用法备注 |
|-------------|------------|----------|
| Neutrals 主底 | `--chijie-background` `#fbfaf7` | 侧栏根底 |
| Neutrals 正文 | `--chijie-foreground` `#1f2d2a` | 主文 100% 层 |
| Neutrals 次要文 | `--chijie-muted` `#687280` | 元信息 / ~60% 层级 |
| Primary / accent | `--chijie-accent` `#166f4e` | 主 CTA、链接、选中、进行中强调 |
| Accent 按下/信号 | `--chijie-accent-signal` `#125842` | 更强调交互 |
| Accent 淡底 | `--chijie-accent-subtle` `#eaf4ef` | active 里程碑、通过 Gate 淡底 |
| Surface 卡片 | `--chijie-surface` `#ffffff` | Mission / Gate 卡 |
| Surface 抬升 | `--chijie-surface-raised` `#f7f5f0` | 次级块 / Findings 行 |
| 边框 | `--chijie-border` / `--chijie-border-strong` | 弱/强分隔；少用重框 |
| 纸系（若卡片纸感） | `--chijie-paper*` | 可选；控制台可多用 surface |
| Supporting 警告 | `--chijie-warning` + `-subtle` | Health slow / recovering |
| Supporting 错误 | `--chijie-danger` + `-subtle` | failed / 停止危险区 |
| 间距单位 | `--chijie-space-unit` `8px` | 一切间距 = n × unit |
| 圆角 | `--chijie-radius-sm|md|lg|xl|pill` | 卡 8–12；pill 状态 chip |
| 字体族 | `--chijie-font-body|mono|hand|serif` | 控制台：body+mono 优先 |

### 4.2 建议新增 token（Notion 有规则、CSS 尚无）

| Notion 规则 | 建议 token | 建议取值来源 | 状态 |
|-------------|------------|--------------|------|
| 字号阶梯 3–5 档 | `--chijie-text-xs` | 11–12px · mono 标签/时间 | **new** |
| | `--chijie-text-sm` | 12–13px · 次要说明 | **new** |
| | `--chijie-text-md` | 14px · 默认正文/Now | **new** |
| | `--chijie-text-lg` | 16px · Mission 标题 | **new** |
| | `--chijie-text-xl` | 18px · 仅 Header 任务名若需要 | **new optional** |
| 字重 | `--chijie-weight-regular` `400` / `--chijie-weight-medium` `500` / `--chijie-weight-semibold` `600` | 现字体已加载 400/500/600 | **new** |
| 行高 | `--chijie-leading-tight` `1.15` / `--chijie-leading-normal` `1.4` | Sajid 标题紧、正文松 | **new** |
| 间距阶梯 | `--chijie-space-1` … `--chijie-space-5` | 4/8/12/16/24（×0.5–3 unit） | **new**（可由 unit 派生） |
| 区块间距 | `--chijie-space-section` | 16 或 24 | **new** |
| 成功语义（Gate passed / complete） | `--chijie-success` + `-subtle` | **未在 notes 定 hex**；可从 accent 派生或 parent 定低饱和绿 | **new · 需色值决策** |
| 健康态色（非仅 warn/danger） | `--chijie-health-advancing` → accent；`recovering` → warning 系；`needs_user` → danger 或独立 | 状态 **必须 + 文案** | **new 语义别名可选** |
| 固定层高度/边距 | `--chijie-panel-pad-x` `12px`；`--chijie-header-min-h`；`--chijie-composer-min-h` | 430 密度未在 Notion 给死数 | **new · 实现时量** |
| 动效 | `--chijie-duration-fast` / `--chijie-ease` | Notion **无数值**；勿瞎编 | **暂不新增** 或 parent 定 120–200ms |

### 4.3 映射关系简图

```text
Notion 规则层
  Hierarchy / Status / Progress / Spacing / Type / Color roles
        │
        ▼
持节 token 层 (chijie-tokens.css)
  已有: color surfaces · accent · warn/danger · 8px unit · radius · font families
  缺: type scale · weight · leading · space ladder · success · panel density
        │
        ▼
008 控制台组件
  Header status · Mission · Gates · Now · Health · Findings · Composer
```

---

## 5. 抓取说明与限制

- 全文深读约 6 页（Principles / Color Branding / Progress / Spacing system / Status visibility / You assist me! 及多篇子页与索引）。
- 大图/视频为主的页（Typography Apple 案例、Color Palettes 图集）以文字规则为准，未从截图 OCR 编造 px。
- Agentive UX 父页多为子页目录；可执行交互规则取自 `You assist me!`。
- 未写入任何 secret；Notion 临时 S3 图链未收录进报告。
- 本地 `DESIGN.md` 为品牌 SSOT 补充源；与 Notion 冲突处一律列入 §3 由 parent 裁。

---

## 6. Parent 下一步（单步）

在 `chijie-tokens.css` 补 **type scale + space ladder +（可选）success**，再按 008 块顺序把现有 side-panel 组件接到 token，不引入 Liquid Glass / 蜡笔红 brand。
