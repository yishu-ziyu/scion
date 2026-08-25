# waiting_user 选项卡

日期：2026-08-24
产品：持节侧栏。根目录 `SPEC.md` 仍只覆盖进行中的 WorkStream，本文不改那份。

参考不是规格：aicss Approval Card 的 Questions 变体。不搬 Plan、Command、Auto Approve 30s。

## 场景

任务停在 `waiting_user`，侧栏恢复区要能画出一句问句和选项。点选项 = 发一条 `follow_up`。自己写 = 只聚焦输入框。

供货有两条，卡是同一张：

1. Agent 自己问的句子（邮箱哪家、是不是常用）写在 `pageReading` 里，能拆出「A还是B」或「是不是」。
2. 把用户这句话绑到当前页已编号控件时，`resolveIntent` 得到多个都对得上、且带可见名字的候选。候选名字来自这一轮观察（`text` / `label` / `placeholder`），不是模型编的，也不是「点击」这个动作的特例。`click_element`、`input_text`、`select_dropdown_option`、`get_dropdown_options` 只要走 `resolveControlIndex`，都用这张卡。自定义 div 菜单仍是 `click_element`。原生 `<select>` 的 option 文案不是这张卡的候选。

不是逐步审批每一次页面动作。`PRODUCT.md`：Do not reintroduce approval-as-main-flow。
登录、验证码、提交不确定、证明完成、模板缺参，不走这张卡。
唯一绑得上，或一个可见名字都没有：不出选项，按原路径做或报错。

## 行为

| 条件 | 画出 | 点下去 |
|---|---|---|
| `waiting_user` + `target_ambiguous` / `target_missing`，且 round.`waitAsk` 有 ≥2 个观察得来的名字 | 问句 + 那些名字 +「自己写」 | 选项 → `handleSendMessage(sendText)`，且 `follow_up` 按 execute 接上（不因分类器把短名字当成闲聊而挡住）；自己写 → `onContinueInComposer` |
| 同上，没有 `waitAsk`，但 `pageReading` 能拆出 2–7 个短选项 | 同上 | 同上 |
| 登录 / 验证码 | 现有「告诉持节继续」 | 不变 |
| `proof_required` | 现有「我确认已经完成」 | 不变，仍 `confirm_completion` |
| 唯一匹配，或候选没有可见名字 | 不画这张卡 | 绑定成功则执行；否则仍是原来的失败/重试字 |
| 查询绑上 ≥2 个同分且带名字的控件，即使动作还带了编号 | 这张卡 | 不执行；编号不能代替用户选 |
| `pageReading` 拆不出选项且没有 `waitAsk` | 现有一句提示 + 补充指令 | 不变 |

问句用绑定用的那串字，例如「这几个都对得上「提交」，要哪一个？」。不要写死「点哪里」。
选项只来自 `resolveIntent` 的同分候选，不把更弱的匹配列进去。
最多七个选项。重名则 `sendText` 用「第N个」+ 名字，好让下一次 `resolveIntent` 能唯一绑上。
没有 Continue / Approve / 倒计时自动批准。没有 `resume`、`wait-continue`、`wait-retry`。

## 成功

- 两个可见名字都对得上同一句查询：`waitAskFromAmbiguousBind` 给出那两个名字；动作不执行。
- 只有一个对得上：不产生 `waitAsk`，动作照常执行。
- 对不上、或对上了但没有可见名字：不产生 `waitAsk`。
- `deriveWaitAsk` 优先用 round.`waitAsk`，否则才拆 `pageReading`。
- 邮箱「要打开的是哪家网页邮箱？谷歌还是微软？」仍拆成 谷歌、微软。
- 登录等待即使 `pageReading` 里有「还是」，也不出选项卡。
- 观察-决定-动作循环遇到 `target_ambiguous` 停在 `waiting_user`，不把任务标失败、不按失败重试。
- `TaskStatusCard` 源码不含 Auto Approve、`wait-continue`、`wait-retry`。
- 两个可见名字的原生 `<select>` 对上同一句查询：`select_dropdown_option` / `get_dropdown_options` 不改页面，同样给出 `waitAsk`。
- 没发生的动作（`attempt.state === 'blocked'`）不在 WorkStream 里画成点击/填写行。细节见 `docs/specs/2026-08-24-bind-wait-residuals.md`。
