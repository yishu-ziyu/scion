/**
 * Human-facing completion outcome lines (design/005 P4, product/017 G-M0).
 * Never expose digests, failure codes, or kernel names.
 */

export type OutcomeEvidence = {
  kind?: string;
  passed?: boolean;
  value?: boolean | string;
};

/** Fallback when evidence yields no specific observable line (design/006 §5 #2). */
export const COMPLETION_RESULT_FALLBACK = '页面结果已核对';

/**
 * Prefer concrete observable outcomes over generic "done".
 */
export function humanCompletionOutcome(input: {
  instructionSummary?: string;
  evidence: OutcomeEvidence[];
}): string | null {
  const passed = input.evidence.filter(item => item.passed);
  const kinds = new Set(passed.map(item => item.kind).filter(Boolean) as string[]);

  if (kinds.has('tab_state')) {
    const closed = passed.some(item => item.kind === 'tab_state' && item.value === 'closed');
    if (closed) return '目标标签已关闭';
  }
  if (kinds.has('media_state')) {
    const paused = passed.some(item => item.kind === 'media_state' && item.value === 'paused');
    const playing = passed.some(item => item.kind === 'media_state' && item.value === 'playing');
    if (paused) return '视频已暂停';
    if (playing) return '视频正在播放';
  }
  if (kinds.has('download_state')) {
    const finished = passed.some(item => item.kind === 'download_state' && item.value === 'finished');
    const started = passed.some(item => item.kind === 'download_state' && item.value === 'started');
    if (finished) return '下载已完成';
    if (started) return '下载已开始';
  }
  if (kinds.has('url')) {
    return '页面地址已符合目标';
  }
  if (kinds.has('page_text') || kinds.has('element_state')) {
    return '页面状态已确认';
  }

  const summary = input.instructionSummary?.replace(/\s+/g, ' ').trim();
  if (summary && summary !== 'User instruction' && !summary.startsWith('Run Skill:')) {
    if (summary.length > 120) return `${summary.slice(0, 117)}…`;
    return summary;
  }
  return null;
}

/**
 * Verified completion must always surface a human result sentence (M0-4 / design/006).
 * Never leave the done block as title-only "任务完成".
 */
export function requiredCompletionResult(input: {
  instructionSummary?: string;
  evidence: OutcomeEvidence[];
  fallback?: string;
}): string {
  return humanCompletionOutcome(input) ?? input.fallback ?? COMPLETION_RESULT_FALLBACK;
}
