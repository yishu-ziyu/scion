/**
 * 现在 = 思考过程 + 执行步骤清单 (Tabbit live-run).
 * Thinking is the current responsibility line, not model chain-of-thought.
 */

import type { ActionAttempt, TaskStatus } from '@extension/storage';

export type NowTraceStepState = 'done' | 'live' | 'pending';

export interface NowTraceStep {
  id: string;
  title: string;
  chip?: string;
  state: NowTraceStepState;
}

export interface NowTraceView {
  thinkingLine: string;
  thinkingOpen: boolean;
  steps: NowTraceStep[];
  stepsOpen: boolean;
}

const STEP_LABELS: Record<string, string> = {
  go_to_url: '页面导航',
  open_tab: '页面导航',
  search_google: '页面导航',
  observe: '获取页面快照',
  snapshot: '获取页面快照',
  evaluate: '获取页面快照',
  extract_content: '抽取内容',
  click_element: '点击',
  input_text: '填写',
  send_keys: '按键',
  find_tab: '查找标签',
  switch_tab: '切换标签',
  focus_tab: '切换标签',
  close_tab: '关闭标签',
  save_screenshot: '截图',
  scroll_to_text: '滚动',
  scroll_to_percent: '滚动',
  wait: '等待',
  done: '交出结果',
};

function compact(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

export function executionStepTitle(attempt: Pick<ActionAttempt, 'actionName' | 'displaySummary' | 'targetLabel'>): string {
  const summary = attempt.displaySummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (summary.length >= 2 && !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(summary)) {
    return compact(summary, 80);
  }
  const verb = STEP_LABELS[attempt.actionName] ?? '操作页面';
  const object = attempt.targetLabel?.replace(/\s+/g, ' ').trim();
  return object ? compact(`${verb}：${object}`, 80) : verb;
}

export function nowTraceStepState(state: ActionAttempt['state'] | string): NowTraceStepState {
  if (state === 'observed') return 'done';
  if (state === 'executing' || state === 'authorized' || state === 'proposed') return 'live';
  return 'pending';
}

export function deriveNowTrace(input: {
  status: TaskStatus | string;
  attempts: ActionAttempt[];
  currentSummary?: string;
}): NowTraceView {
  const running = input.status === 'running';
  const latest = input.attempts[input.attempts.length - 1];
  const live =
    !!latest &&
    (latest.state === 'proposed' || latest.state === 'authorized' || latest.state === 'executing');
  const current = input.currentSummary?.replace(/\s+/g, ' ').trim();
  let thinkingLine = '思考中';
  if (running && live) thinkingLine = current || executionStepTitle(latest) || '思考中';
  else if (running) thinkingLine = '思考中';
  else if (input.status === 'failed') thinkingLine = '';
  else if (current) thinkingLine = current;
  else thinkingLine = input.attempts.length > 0 ? '已按步骤做完' : '还没有开始';

  return {
    thinkingLine,
    thinkingOpen: running,
    steps: input.attempts.map(attempt => ({
      id: attempt.id,
      title: executionStepTitle(attempt),
      chip: attempt.targetLabel?.trim() || undefined,
      state: nowTraceStepState(attempt.state),
    })),
    stepsOpen: running,
  };
}
