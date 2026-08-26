# Provider / 模型配置盘点（能力协议迁移准备）

只读盘点，2026-08-26。所有结论来自当前代码，未做任何改动。

## 1. 模型配置存在哪

### Storage 键（`chrome.storage.local`，全部 `liveUpdate: true`）

| 键 | 文件 | 内容 |
|---|---|---|
| `llm-api-keys` | `packages/storage/lib/settings/llmProviders.ts` | `LLMKeyRecord.providers: Record<providerId, ProviderConfig>`。providerId 内置时等于 ProviderTypeEnum，自定义/Azure 副实例可为任意字符串（如 `azure_openai_2`、`minimax`） |
| `agent-models` | `packages/storage/lib/settings/agentModels.ts` | `AgentModelRecord.agents: Record<AgentNameEnum, ModelConfig>`。`ModelConfig = { provider(=providerId), modelName, parameters?, reasoningEffort? }` |
| `speech-to-text-model` | `packages/storage/lib/settings/speechToText.ts` | `{ provider, modelName }`，密钥仍从 `llm-api-keys` 里按 provider 取 |

`AgentNameEnum` 只有三个值：`planner / navigator / validator`。`ProviderTypeEnum` 12 个值（openai、anthropic、deepseek、gemini、grok、ollama、azure_openai、openrouter、groq、cerebras、llama、custom_openai），`llmProviderModelNames` 给每个内置 provider 硬编码了模型名清单，`llmProviderParameters` 按 (provider, agent) 硬编码默认 temperature/topP。

### `ProviderConfig` 现状字段

`name? / type? / apiKey / baseUrl? / modelNames? / createdAt? / azureDeploymentNames? / azureApiVersion?`。
注意：`apiKey` 明文内联在 provider 记录里；Azure 用 deploymentNames 替代 modelNames；`type` 可由 providerId 反推（`getProviderTypeByProviderId`），读路径有 `ensureBackwardCompatibility` 补默认值。

### `createChatModel` 调用链

- 定义：`chrome-extension/src/background/agent/helper.ts` → `createChatModel(providerConfig, modelConfig)`，按 `modelConfig.provider` 分派到各 LangChain 包（ChatOpenAI/AzureChatOpenAI/ChatAnthropic/ChatDeepSeek/ChatGoogleGenerativeAI/ChatXAI/ChatGroq/ChatCerebras/ChatOllama，自定义走 ChatOpenAI 兼容；Llama 用本地 `ChatLlama` 子类改响应格式；o 系 / gpt-5 走 `modelKwargs.reasoning_effort`）。
- 调用方只有两个，都在 background：
  - `agent/backends/control-llm.ts` `createLlmControlDriver()`：navigator 模型作主 LLM；validator 模型作 supervisor（同 provider+model 时复用同一实例）；planner 仅在 navigator 缺失时兜底。
  - `agent/structure-user-memory.ts`：复用 navigator（缺则 planner）模型做记忆结构化。
- `speechToText` 不走 `createChatModel`：`background/services/speechToText.ts` 直接 `new ChatGoogleGenerativeAI`，且硬编码要求 `provider.type === 'gemini'`。

## 2. 功能 → 模型绑定现状

| 功能 | 绑定来源 | 实际模型 |
|---|---|---|
| 主 Agent 循环（执行 + 监督） | `agent-models[navigator]`（主）、`agent-models[validator]`（supervisor，可缺省复用 navigator） | 个人 fork 经 `personal/bootstrap.ts` 全部强制刷成 `minimax / MiniMax-M3` |
| 记忆结构化 | navigator ?? planner | 同上 |
| 语音转文字 | `speech-to-text-model` 键 | 仅支持 Gemini provider，代码里写死 |
| planner | 只被 FirstRunSetup / options 写入，运行时无独立 LLM 调用，仅作兜底 | — |

`personal/bootstrap.ts`（`ensurePersonalDefaults`）每次 setup 时删掉其它所有 provider、重写三个 agent 的模型指向 `minimax`，即 GUI 设置实际会被覆盖。密钥经 `scripts/inject-personal-secrets.mjs` 在构建时注入 `chrome-extension/src/personal/secrets.local.ts`（gitignored）。

## 3. 密钥位置与安全边界

- 密钥明文存于 `chrome.storage.local` 的 `llm-api-keys` 记录内（`ProviderConfig.apiKey`），无加密、无独立密钥引用层。
- 读取方：background（helper.ts / speechToText.ts / control-llm.ts / index.ts）与扩展页面（options `ModelSettings.tsx`、side-panel `SidePanel.tsx` / `FirstRunSetup.tsx`，侧栏只检查非空、不外发）。
- content script 零命中：`chrome-extension/src/content`、`pages/content*` 中没有任何 `llmProviderStore / agentModelStore / apiKey` 引用。LLM 调用全部发生在 background service worker，密钥不进页面上下文——这是当前事实上的安全边界，靠"只在 background import"维持，没有机制强制。
- 另一份密钥副本在构建产物里：`secrets.local.ts` 被 import 进 background bundle，keyPrefix/keyLen 会打进 background 日志。

## 4. ProviderConfig → ProviderProfile / ModelDescriptor 映射

假设新模型为：`ProviderProfile`（连接级）+ `ModelDescriptor`（模型级，含能力声明），密钥经 `apiKeyRef` 间接引用。

| 现有（ProviderConfig / ModelConfig） | 新（建议归属） | 备注 |
|---|---|---|
| providerId（记录键） | ProviderProfile.id | Azure 副实例 `azure_openai_2` 这类"id ≠ type"要靠 profile 显式存 adapterType 解决 |
| `name` | ProviderProfile.displayName | 直通 |
| `type` (+ id 反推逻辑) | ProviderProfile.adapterType | **缺**：现在是枚举+前缀启发式，新模型需显式字段 |
| `apiKey` | apiKeyRef → 独立密钥存储 | **缺**：当前明文内联，迁移需拆出密钥层并改所有读取方 |
| `baseUrl` | ProviderProfile.baseUrl | 直通（Azure 语义是 endpoint） |
| `azureDeploymentNames` / `azureApiVersion` | ProviderProfile.azure.* 或 adapter 私有配置 | 直通；Azure 的"模型=deployment"耦合要在 ModelDescriptor 层解掉 |
| `modelNames[]` | 每个模型一条 ModelDescriptor { id, providerId/ref } | 需拆分 |
| ModelConfig.provider + modelName | 功能绑定 → ModelDescriptor 引用 | `agent-models` 与 `speech-to-text-model` 两个键都是 `{provider, modelName}` 形态 |
| ModelConfig.parameters / reasoningEffort | ModelDescriptor 默认参数 或 绑定处覆盖参数 | 现默认参数来自硬编码 `llmProviderParameters` 表 + 存储合并两层 |
| `createdAt` | ProviderProfile.createdAt | 直通 |
| — | **ModelDescriptor.capabilities** | **缺**：现在能力靠 `isOpenAIReasoningModel(modelName)` 字符串猜测 + speechToText 硬编码 gemini。reasoning / audio 输入 / tool use / context window（Ollama numCtx 64000 写死）都无声明位 |
| — | adapter 级 extra headers | 现仅 OpenRouter 特判（HTTP-Referer / X-Title 写死在 helper.ts） |

迁移数据源注意点：`llmProviderStore` 读路径有 `ensureBackwardCompatibility` 在线修补（补 name/type/createdAt、Azure 删 modelNames），迁移脚本应基于修补后的输出，且要处理 Azure 自定义 id、Ollama 空 key、custom_openai 任意 id 三种边角。

## 5. 迁移要改的文件清单

存储与类型：
- `packages/storage/lib/settings/llmProviders.ts`（ProviderConfig → ProviderProfile + apiKeyRef）
- `packages/storage/lib/settings/agentModels.ts`（ModelConfig → 绑定 ModelDescriptor）
- `packages/storage/lib/settings/speechToText.ts`（同上）
- `packages/storage/lib/settings/types.ts`（ProviderTypeEnum、llmProviderModelNames、llmProviderParameters）
- `packages/storage/lib/settings/index.ts`（导出面）

模型构造与调用：
- `chrome-extension/src/background/agent/helper.ts`（createChatModel → adapter 分派）
- `chrome-extension/src/background/agent/backends/control-llm.ts`（取模型处）
- `chrome-extension/src/background/agent/structure-user-memory.ts`
- `chrome-extension/src/background/services/speechToText.ts`（去掉 gemini 硬编码，改走 capabilities）
- `chrome-extension/src/background/index.ts`（speech_to_text 消息处理处取 providers）

个人 fork：
- `chrome-extension/src/personal/bootstrap.ts`、`chrome-extension/src/personal/config.ts`、`chrome-extension/scripts/inject-personal-secrets.mjs`

UI：
- `pages/options/src/components/ModelSettings.tsx`（provider CRUD + agent 绑定 + STT 选择，最大的一块）
- `pages/side-panel/src/SidePanel.tsx`（checkModelConfiguration）
- `pages/side-panel/src/components/FirstRunSetup.tsx`

另需新增：密钥存储模块（apiKeyRef 解析层）与一次性迁移脚本（`llm-api-keys` / `agent-models` / `speech-to-text-model` 三个旧键 → 新结构）。
