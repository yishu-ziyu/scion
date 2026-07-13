# Idea

## Original request

- 依据现有测试报告，先关闭阻塞项，再开启新的修复复合周期。
- 阻塞项关闭后，对 Nanobrowser 进行一次较大的二次开发。
- 本阶段从产品 intake 和架构设计开始。
- Owner 授权：按照 Codex 的建议推进，但涉及产品类型、目标用户和硬架构边界的决策仍由 Owner 拍板。

## Current baseline

- Section 14 推荐的 BrowserContext 扩展页隔离阻塞已关闭。
- 本轮只做产品定义、范围收敛、架构选型和详细设计，不写业务实现代码。

## Intake clarification

- “面向个人高级用户的 C 端 BYOK AI 浏览器助手”只描述了用户和交付方式，没有定义用户要完成的任务，与现有 Nanobrowser 不构成有效产品差异，因此不作为产品方向。
- 产品定义必须同时回答：替谁完成什么任务、交付什么可验证结果、为什么现有 Nanobrowser 做不到或做不好。
- 当时 `product-type` 闸门保持未通过，先确定核心任务；后续澄清见下节。

## Accepted product intent

Owner subsequently clarified the target through concrete tasks:

- 在浏览器侧边栏下达自然语言目标，例如“打开飞书并完成一张表单”。
- Agent 必须执行完整动作链并交付结果，不能只打开目标网页。
- 同一会话中可以继续控制已经打开的页面，例如在 B 站收藏夹中播放视频后，再用“暂停”控制当前视频。
- 产品价值来自可扩展的通用网页行动能力，而不是某个垂直研究场景。

Canonical direction: a consumer browser action agent that uses the user's real Chrome session, completes multi-step web tasks to a verifiable outcome, and remains controllable through follow-up instructions.
