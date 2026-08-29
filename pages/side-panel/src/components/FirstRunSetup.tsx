/**
 * First-run model setup (setup.input | connecting | error | success).
 * One job: connect a model → validate → idle.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ProviderTypeEnum,
  agentModelStore,
  getDefaultProviderConfig,
  llmProviderModelNames,
  llmProviderStore,
} from '@extension/storage';
import { resolveBaseUrl, validateModelConnection } from './validate-model-connection';

type SetupPhase = 'input' | 'connecting' | 'error' | 'success';

type SetupProviderOption = {
  id: string;
  label: string;
  type: ProviderTypeEnum;
  models: string[];
  defaultModel: string;
  defaultBaseUrl?: string;
  /** Base URL lives under advanced by default */
  baseUrlAdvanced?: boolean;
  requiresApiKey: boolean;
};

const SETUP_PROVIDERS: SetupProviderOption[] = [
  {
    id: 'minimax',
    label: 'MiniMax（推荐）',
    type: ProviderTypeEnum.CustomOpenAI,
    models: ['MiniMax-M3'],
    defaultModel: 'MiniMax-M3',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    baseUrlAdvanced: true,
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.OpenAI,
    label: 'OpenAI',
    type: ProviderTypeEnum.OpenAI,
    models: [...(llmProviderModelNames[ProviderTypeEnum.OpenAI] || [])],
    defaultModel: 'gpt-4.1-mini',
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.OpenRouter,
    label: 'OpenRouter',
    type: ProviderTypeEnum.OpenRouter,
    models: [...(llmProviderModelNames[ProviderTypeEnum.OpenRouter] || [])],
    defaultModel: 'google/gemini-2.5-flash',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlAdvanced: true,
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.Anthropic,
    label: 'Anthropic',
    type: ProviderTypeEnum.Anthropic,
    models: [...(llmProviderModelNames[ProviderTypeEnum.Anthropic] || [])],
    defaultModel: 'claude-haiku-4-5',
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.Grok,
    label: 'Grok',
    type: ProviderTypeEnum.Grok,
    models: [...(llmProviderModelNames[ProviderTypeEnum.Grok] || [])],
    defaultModel: 'grok-4-fast-non-reasoning',
    defaultBaseUrl: 'https://api.x.ai/v1',
    baseUrlAdvanced: true,
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.DeepSeek,
    label: 'DeepSeek',
    type: ProviderTypeEnum.DeepSeek,
    models: [...(llmProviderModelNames[ProviderTypeEnum.DeepSeek] || [])],
    defaultModel: 'deepseek-chat',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlAdvanced: true,
    requiresApiKey: true,
  },
  {
    id: ProviderTypeEnum.Ollama,
    label: 'Ollama（本机）',
    type: ProviderTypeEnum.Ollama,
    models: [...(llmProviderModelNames[ProviderTypeEnum.Ollama] || [])],
    defaultModel: 'qwen3:14b',
    defaultBaseUrl: 'http://localhost:11434',
    baseUrlAdvanced: true,
    requiresApiKey: false,
  },
  {
    id: 'custom_openai',
    label: '自定义 OpenAI 兼容',
    type: ProviderTypeEnum.CustomOpenAI,
    models: [],
    defaultModel: '',
    defaultBaseUrl: '',
    baseUrlAdvanced: false,
    requiresApiKey: true,
  },
];

export type FirstRunSetupProps = {
  onConnected: () => void;
};

export default function FirstRunSetup({ onConnected }: FirstRunSetupProps) {
  const [phase, setPhase] = useState<SetupPhase>('input');
  const [providerId, setProviderId] = useState(SETUP_PROVIDERS[0].id);
  const [model, setModel] = useState(SETUP_PROVIDERS[0].defaultModel);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(SETUP_PROVIDERS[0].defaultBaseUrl || '');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hydrated, setHydrated] = useState(false);

  const provider = useMemo(() => SETUP_PROVIDERS.find(p => p.id === providerId) || SETUP_PROVIDERS[0], [providerId]);

  // Prefill non-sensitive fields if a partial config already exists
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await llmProviderStore.getAllProviders();
        const preferred =
          all.minimax || all[ProviderTypeEnum.OpenAI] || all[ProviderTypeEnum.OpenRouter] || Object.values(all)[0];
        if (!preferred || cancelled) {
          setHydrated(true);
          return;
        }
        const match =
          SETUP_PROVIDERS.find(p => p.id === 'minimax' && all.minimax) ||
          SETUP_PROVIDERS.find(p => p.id === preferred.type) ||
          SETUP_PROVIDERS.find(p => all[p.id]);
        if (match) {
          setProviderId(match.id);
          setBaseUrl(preferred.baseUrl || match.defaultBaseUrl || '');
          const models = preferred.modelNames?.length ? preferred.modelNames : match.models;
          setModel(models[0] || match.defaultModel || '');
          // Never prefill api key into plaintext state from storage for security UX:
          // if key exists, leave empty and show placeholder that key is saved.
          if (preferred.apiKey) {
            setApiKey('');
          }
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onProviderChange = (nextId: string) => {
    const next = SETUP_PROVIDERS.find(p => p.id === nextId) || SETUP_PROVIDERS[0];
    setProviderId(next.id);
    setModel(next.defaultModel);
    setBaseUrl(next.defaultBaseUrl || '');
    setErrorMessage('');
    setPhase('input');
    if (next.id === 'custom_openai') setAdvancedOpen(true);
  };

  const connect = useCallback(async () => {
    setErrorMessage('');
    setPhase('connecting');

    const existing = await llmProviderStore.getProvider(provider.id);
    const keyToUse = apiKey.trim() || existing?.apiKey?.trim() || (provider.requiresApiKey ? '' : 'ollama');
    const baseToUse = baseUrl.trim() || provider.defaultBaseUrl || existing?.baseUrl || '';

    const result = await validateModelConnection({
      providerType: provider.type,
      apiKey: keyToUse,
      baseUrl: baseToUse,
      model: model.trim(),
    });

    if (!result.ok) {
      setErrorMessage(result.message);
      setPhase('error');
      return;
    }

    const baseConfig = getDefaultProviderConfig(provider.type);
    await llmProviderStore.setProvider(provider.id, {
      ...baseConfig,
      name: provider.label,
      type: provider.type,
      apiKey: keyToUse,
      baseUrl: resolveBaseUrl(provider.type, baseToUse) || undefined,
      modelNames: model.trim() ? Array.from(new Set([model.trim(), ...(provider.models || [])])) : provider.models,
      createdAt: existing?.createdAt || Date.now(),
    });

    await agentModelStore.setModel({
      provider: provider.id,
      modelName: model.trim(),
    });

    setPhase('success');
    window.setTimeout(() => {
      onConnected();
    }, 450);
  }, [apiKey, baseUrl, model, onConnected, provider]);

  if (!hydrated) {
    return (
      <div className="chijie-welcome" data-testid="first-run-loading">
        <p className="text-center text-sm text-[var(--chijie-muted)]">准备首次配置…</p>
      </div>
    );
  }

  const buttonLabel =
    phase === 'connecting'
      ? '正在验证连接…'
      : phase === 'error'
        ? '重新连接'
        : phase === 'success'
          ? '连接成功'
          : '连接并开始';

  const showBaseInAdvanced = provider.baseUrlAdvanced !== false || provider.id === 'custom_openai';
  const forceShowBase = provider.id === 'custom_openai';

  return (
    <div className="chijie-welcome chijie-first-setup" data-testid="first-run-setup" data-phase={phase}>
      <div className="chijie-first-setup-inner">
        <img
          src={chrome.runtime.getURL('logo-mark.png')}
          alt=""
          className="chijie-first-setup-logo"
          data-testid="welcome-logo"
        />
        <p className="chijie-first-setup-kicker">首次配置</p>
        <h2 className="chijie-first-setup-title">连接一个模型</h2>
        <p className="chijie-first-setup-lead">
          持节需要一个可用模型来规划和执行任务。配置完成后，就可以直接开始使用。
        </p>

        <div className="chijie-first-setup-form">
          <label className="chijie-first-setup-label" htmlFor="setup-provider">
            模型服务
          </label>
          <select
            id="setup-provider"
            className="chijie-first-setup-control"
            value={providerId}
            disabled={phase === 'connecting' || phase === 'success'}
            onChange={e => onProviderChange(e.target.value)}
            data-testid="setup-provider">
            {SETUP_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <label className="chijie-first-setup-label" htmlFor="setup-model">
            模型
          </label>
          {provider.models.length > 0 ? (
            <select
              id="setup-model"
              className="chijie-first-setup-control"
              value={model}
              disabled={phase === 'connecting' || phase === 'success'}
              onChange={e => setModel(e.target.value)}
              data-testid="setup-model">
              {provider.models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="setup-model"
              className="chijie-first-setup-control"
              value={model}
              placeholder="模型名称"
              disabled={phase === 'connecting' || phase === 'success'}
              onChange={e => setModel(e.target.value)}
              data-testid="setup-model"
            />
          )}

          {provider.requiresApiKey && (
            <>
              <label className="chijie-first-setup-label" htmlFor="setup-apikey">
                API Key
              </label>
              <input
                id="setup-apikey"
                type="password"
                autoComplete="off"
                className="chijie-first-setup-control"
                value={apiKey}
                placeholder="粘贴 API Key"
                disabled={phase === 'connecting' || phase === 'success'}
                onChange={e => setApiKey(e.target.value)}
                data-testid="setup-apikey"
              />
            </>
          )}

          {(showBaseInAdvanced || forceShowBase) && (
            <div className="chijie-first-setup-advanced">
              <button
                type="button"
                className="chijie-first-setup-advanced-toggle"
                onClick={() => setAdvancedOpen(v => !v)}
                data-testid="setup-advanced-toggle">
                {advancedOpen || forceShowBase ? '▾' : '▸'} 高级设置
              </button>
              {(advancedOpen || forceShowBase) && (
                <div className="chijie-first-setup-advanced-body">
                  <label className="chijie-first-setup-label" htmlFor="setup-baseurl">
                    Base URL
                  </label>
                  <input
                    id="setup-baseurl"
                    className="chijie-first-setup-control"
                    value={baseUrl}
                    placeholder={provider.defaultBaseUrl || 'https://…/v1'}
                    disabled={phase === 'connecting' || phase === 'success'}
                    onChange={e => setBaseUrl(e.target.value)}
                    data-testid="setup-baseurl"
                  />
                </div>
              )}
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <div className="chijie-first-setup-error" role="alert" data-testid="setup-error">
              <div className="chijie-first-setup-error-title">连接失败</div>
              <div className="chijie-first-setup-error-body">{errorMessage}</div>
            </div>
          )}

          {phase === 'success' && (
            <div className="chijie-first-setup-success" data-testid="setup-success">
              ✓ 连接成功
            </div>
          )}

          <button
            type="button"
            className="chijie-btn-primary chijie-first-setup-submit"
            disabled={phase === 'connecting' || phase === 'success' || !model.trim()}
            onClick={() => void connect()}
            data-testid="setup-submit">
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
