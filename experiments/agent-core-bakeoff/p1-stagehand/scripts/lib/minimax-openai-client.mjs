/**
 * MiniMax OpenAI-compatible client for Stagehand.
 * MiniMax-M3 often returns <think>…</think> then JSON; Stagehand's CustomOpenAIClient
 * does JSON.parse on raw content and fails. We wrap the OpenAI client so content is
 * cleaned before Stagehand parses it.
 */
import OpenAI from 'openai';
import { CustomOpenAIClient } from '@browserbasehq/stagehand';

export function stripThink(text) {
  if (!text) return text;
  let out = String(text);
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = out.search(/<think>/i);
  if (open >= 0) {
    const close = out.search(/<\/think>/i);
    out = close < 0 ? out.slice(0, open) : out.slice(0, open) + out.slice(close + 8);
  }
  return out.trim();
}

export function extractJsonCandidate(text) {
  const cleaned = stripThink(text);
  if (!cleaned) return cleaned;
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = cleaned.search(/[{[]/);
  if (start < 0) return cleaned;
  const openCh = cleaned[start];
  const closeCh = openCh === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned.slice(start);
}

/**
 * @param {{ apiKey: string, baseURL: string, modelName: string }} cfg
 */
export function createMiniMaxLlmClient(cfg) {
  const raw = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
  });

  // Wrap completions.create to normalize MiniMax content for Stagehand JSON.parse.
  const originalCreate = raw.chat.completions.create.bind(raw.chat.completions);
  raw.chat.completions.create = async (body, options) => {
    // Encourage JSON; MiniMax may still ignore response_format.
    const nextBody = { ...body };
    if (nextBody.response_format?.type === 'json_object' && Array.isArray(nextBody.messages)) {
      nextBody.messages = [
        ...nextBody.messages,
        {
          role: 'user',
          content:
            'Final answer must be a single JSON object only. No markdown fences. Put any reasoning inside <think></think> and put pure JSON after it.',
        },
      ];
    }

    const response = await originalCreate(nextBody, options);
    try {
      const choice = response?.choices?.[0];
      if (choice?.message?.content && typeof choice.message.content === 'string') {
        const rawContent = choice.message.content;
        const cleaned = extractJsonCandidate(rawContent);
        // Only replace when we improved parseability
        try {
          JSON.parse(cleaned);
          choice.message.content = cleaned;
        } catch {
          // leave original; Stagehand will retry
          choice.message.content = stripThink(rawContent);
        }
      }
    } catch {
      // never break the call path for logging issues
    }
    return response;
  };

  return new CustomOpenAIClient({
    modelName: cfg.modelName,
    client: raw,
  });
}
