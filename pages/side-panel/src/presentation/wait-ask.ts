import type { TaskStatus, WaitReason } from '@extension/storage';

export type WaitAskOption = {
  id: string;
  label: string;
  sendText: string;
};

export type WaitAsk = {
  prompt: string;
  options: WaitAskOption[];
};

const ASK_REASONS = new Set<WaitReason>(['target_ambiguous', 'target_missing']);
const MAX_OPTIONS = 7;
const MAX_LABEL = 40;

function cleanLabel(value: string): string {
  return value.replace(/^[，,、\s]+|[。！!，,、\s]+$/g, '').trim();
}

function yesNoOptions(): WaitAskOption[] {
  return [
    { id: 'yes', label: '是', sendText: '是' },
    { id: 'no', label: '不是', sendText: '不是' },
  ];
}

function orOptions(prompt: string): WaitAskOption[] | null {
  const parts = prompt.split(/[?？]/);
  const clause = [...parts].reverse().find(part => part.includes('还是')) ?? (prompt.includes('还是') ? prompt : '');
  if (!clause) return null;
  const labels = clause
    .split('还是')
    .map(cleanLabel)
    .filter(label => label.length >= 1 && label.length <= MAX_LABEL);
  if (labels.length < 2 || labels.length > MAX_OPTIONS) return null;
  if (new Set(labels).size !== labels.length) return null;
  return labels.map((label, index) => ({
    id: `opt-${index}`,
    label,
    sendText: label,
  }));
}

function parseWaitAskPrompt(pageReading: string): WaitAsk | null {
  const prompt = pageReading.replace(/\s+/g, ' ').trim();
  if (prompt.length < 4) return null;
  if (!/[?？]/.test(prompt)) return null;
  if (/是不是/.test(prompt)) {
    return { prompt, options: yesNoOptions() };
  }
  const options = orOptions(prompt);
  if (!options) return null;
  return { prompt, options };
}

function fromStoredWaitAsk(waitAsk: {
  prompt?: string;
  options?: Array<{ label?: string; sendText?: string }>;
}): WaitAsk | null {
  const prompt = waitAsk.prompt?.replace(/\s+/g, ' ').trim() ?? '';
  const options = (waitAsk.options ?? [])
    .map((option, index) => {
      const sendText = option.sendText?.replace(/\s+/g, ' ').trim() ?? '';
      const label = (option.label ?? sendText).replace(/\s+/g, ' ').trim();
      if (!sendText || !label || label.length > MAX_LABEL + 4) return null;
      return { id: `opt-${index}`, label: label.slice(0, MAX_LABEL), sendText };
    })
    .filter((option): option is WaitAskOption => Boolean(option))
    .slice(0, MAX_OPTIONS);
  if (!prompt || options.length < 2) return null;
  return { prompt, options };
}

export function deriveWaitAsk(input: {
  status: TaskStatus;
  waitReason?: WaitReason | null;
  pageReading?: string | null;
  waitAsk?: { prompt?: string; options?: Array<{ label?: string; sendText?: string }> } | null;
}): WaitAsk | null {
  if (input.status !== 'waiting_user') return null;
  if (!input.waitReason || !ASK_REASONS.has(input.waitReason)) return null;
  const stored = input.waitAsk ? fromStoredWaitAsk(input.waitAsk) : null;
  if (stored) return stored;
  const text = input.pageReading?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return null;
  return parseWaitAskPrompt(text);
}
