/**
 * Lowest-cost live connectivity check for first-run setup.
 * OpenAI-compatible providers share one path; Anthropic uses Messages API.
 */

export type ConnectionValidateInput = {
  providerType: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
};

export type ConnectionValidateResult =
  | { ok: true }
  | { ok: false; message: string };

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function defaultBaseUrl(providerType: string): string {
  switch (providerType) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'grok':
      return 'https://api.x.ai/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'cerebras':
      return 'https://api.cerebras.ai/v1';
    case 'llama':
      return 'https://api.llama.com/v1';
    case 'ollama':
      return 'http://localhost:11434';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta';
    default:
      return '';
  }
}

export function resolveBaseUrl(providerType: string, baseUrl?: string): string {
  const trimmed = (baseUrl || '').trim();
  if (trimmed) return stripSlash(trimmed);
  return stripSlash(defaultBaseUrl(providerType));
}

function humanizeHttpError(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403 || lower.includes('invalid_api_key') || lower.includes('incorrect api key')) {
    return 'API Key 无效。请检查后重试。';
  }
  if (status === 404 || lower.includes('model_not_found') || lower.includes('does not exist')) {
    return '模型不存在或当前账号无权访问该模型。';
  }
  if (status === 429) {
    return '请求过于频繁或额度不足，请稍后再试。';
  }
  if (status >= 500) {
    return '模型服务暂时不可用，请稍后重试。';
  }
  if (lower.includes('insufficient')) {
    return '账户额度不足，请充值或更换密钥。';
  }
  return `连接失败（HTTP ${status}）。请检查 Key、模型名与网络。`;
}

async function validateOpenAICompat(input: ConnectionValidateInput): Promise<ConnectionValidateResult> {
  const base = resolveBaseUrl(input.providerType, input.baseUrl);
  if (!base) {
    return { ok: false, message: '请填写 Base URL（OpenAI 兼容端点）。' };
  }
  const url = `${base}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, message: humanizeHttpError(res.status, text) };
  } catch {
    return { ok: false, message: '服务不可访问。请检查网络、Base URL 或本机服务是否已启动。' };
  }
}

async function validateAnthropic(input: ConnectionValidateInput): Promise<ConnectionValidateResult> {
  const base = resolveBaseUrl('anthropic', input.baseUrl) || 'https://api.anthropic.com';
  try {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, message: humanizeHttpError(res.status, text) };
  } catch {
    return { ok: false, message: '服务不可访问。请检查网络后重试。' };
  }
}

async function validateOllama(input: ConnectionValidateInput): Promise<ConnectionValidateResult> {
  const base = resolveBaseUrl('ollama', input.baseUrl) || 'http://localhost:11434';
  try {
    const res = await fetch(`${base}/api/tags`, { method: 'GET' });
    if (!res.ok) {
      return { ok: false, message: '无法连接本机 Ollama。请确认 Ollama 已启动。' };
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models || []).map(m => m.name || '');
    if (input.model && names.length > 0 && !names.some(n => n === input.model || n.startsWith(`${input.model}:`))) {
      // Soft warn still ok if tags list incomplete; require at least server up
      return { ok: true };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: '无法连接本机 Ollama（默认 localhost:11434）。请先启动 Ollama。' };
  }
}

/** Public entry used by first-run setup. */
export async function validateModelConnection(input: ConnectionValidateInput): Promise<ConnectionValidateResult> {
  const model = input.model.trim();
  if (!model) return { ok: false, message: '请选择或填写模型名称。' };

  const type = input.providerType;
  if (type === 'ollama') {
    return validateOllama(input);
  }
  if (type === 'anthropic') {
    if (!input.apiKey.trim()) return { ok: false, message: '请填写 API Key。' };
    return validateAnthropic(input);
  }
  // Gemini not in first-run primary path — treat as openai-compat if base set, else fail clear
  if (type === 'gemini') {
    return { ok: false, message: '首次配置请先选 MiniMax / OpenAI / OpenRouter 等服务；Gemini 可在设置中配置。' };
  }
  if (type === 'azure_openai') {
    return { ok: false, message: 'Azure 请到设置页配置端点与部署名；首次配置请用 MiniMax 或 OpenAI。' };
  }
  if (!input.apiKey.trim() && type !== 'ollama') {
    return { ok: false, message: '请填写 API Key。' };
  }
  return validateOpenAICompat(input);
}
