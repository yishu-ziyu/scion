/**
 * Honest goal coverage for completion UI (product/017, design/005).
 * Defends against incomplete multi-intent goals that only froze media criteria.
 */

export type GoalCoverage = 'full' | 'partial' | 'unknown';

export type GoalCoverageInput = {
  /** User-visible goal text (preferred) or instruction summary. */
  goalText: string;
  evidence: Array<{ kind?: string; passed?: boolean; value?: boolean | string }>;
  /** Model/agent answer surfaced on the round, if any. */
  answerText?: string;
};

export type GoalCoverageResult = {
  coverage: GoalCoverage;
  /** Short lines: what was verified. */
  done: string[];
  /** Short lines: what the goal still asked for but evidence does not show. */
  missing: string[];
};

function hasPassed(evidence: GoalCoverageInput['evidence'], kind: string, value?: string): boolean {
  return evidence.some(
    item =>
      item.passed &&
      item.kind === kind &&
      (value === undefined || item.value === value || String(item.value) === value),
  );
}

function wantsMediaPlay(goal: string): boolean {
  return /播放|开始播|点.*播放|play\b/i.test(goal);
}

function wantsMediaPause(goal: string): boolean {
  return /暂停|停一下|停止播放|\bpause\b/i.test(goal);
}

function wantsCloseTab(goal: string): boolean {
  return /关掉|关闭.*(页|标签)|关页|close\s+(this\s+)?(tab|page)/i.test(goal);
}

/** User expects text/content delivered back (comment, copy, summary, tell me). */
export function wantsContentDeliverable(goal: string): boolean {
  const g = goal.replace(/\s+/g, ' ').trim();
  if (!g) return false;
  return (
    /复制/.test(g) ||
    /发给我|发我|告诉我|回复我|贴给我/.test(g) ||
    /第一条评论|评论内容|热评/.test(g) ||
    /摘录|摘要|总结/.test(g) ||
    /把.{1,40}给(我|你)/.test(g) ||
    /\b(copy|tell me|send me|first comment)\b/i.test(g)
  );
}

/** Page/media status lines are evidence, not the content the user asked to receive. */
export function isStatusOnlyAnswer(answer: string | undefined): boolean {
  const s = answer?.replace(/\s+/g, ' ').trim() ?? '';
  if (!s) return true;
  if (/^(done|完成|ok|已完成|success|好了|opened|playing|paused)[.!。！]*$/i.test(s)) return true;
  if (/User instruction/i.test(s)) return true;
  if (/^(视频|媒体).{0,12}(播放|暂停|核对)/.test(s)) return true;
  if (/^(目标)?标签已关闭/.test(s)) return true;
  if (/^页面(地址|状态)已/.test(s)) return true;
  if (/^下载已(开始|完成)/.test(s)) return true;
  if (/^(Browser opened|Switched to|Playing video|Opened )/i.test(s)) return true;
  return false;
}

/**
 * True only when the string looks like user-facing extracted content,
 * not a goal echo or a page-state status line.
 */
export function hasSubstantiveAnswer(answer: string | undefined, goalText?: string): boolean {
  const s = answer?.replace(/\s+/g, ' ').trim() ?? '';
  if (s.length < 8) return false;
  if (isStatusOnlyAnswer(s)) return false;
  const goal = goalText?.replace(/\s+/g, ' ').trim() ?? '';
  if (goal && (s === goal || (s.length <= goal.length + 4 && goal.includes(s)) || s.includes(goal))) {
    // Goal restated as "answer" is not a deliverable.
    return false;
  }
  return true;
}

/**
 * Prefer a real agent answer; never treat the goal text or media status as the deliverable.
 */
export function resolveDeliverableAnswer(input: {
  instructionSummary?: string;
  goalText?: string;
  completionOutcome?: string | null;
}): string | undefined {
  const goal = input.goalText?.replace(/\s+/g, ' ').trim() ?? '';
  const summary = input.instructionSummary?.replace(/\s+/g, ' ').trim() ?? '';
  if (hasSubstantiveAnswer(summary, goal)) return summary;
  const outcome = input.completionOutcome?.replace(/\s+/g, ' ').trim() ?? '';
  if (hasSubstantiveAnswer(outcome, goal)) return outcome;
  return undefined;
}

/**
 * Compare multi-part goals to frozen evidence so UI does not say "放心结束" after a half job.
 */
export function assessGoalCoverage(input: GoalCoverageInput): GoalCoverageResult {
  const goal = input.goalText.replace(/\s+/g, ' ').trim();
  const done: string[] = [];
  const missing: string[] = [];

  if (wantsMediaPlay(goal)) {
    if (hasPassed(input.evidence, 'media_state', 'playing') || hasPassed(input.evidence, 'media_state')) {
      done.push('视频已播放或媒体状态已核对');
    } else {
      missing.push('播放视频');
    }
  }
  if (wantsMediaPause(goal)) {
    if (hasPassed(input.evidence, 'media_state', 'paused')) {
      done.push('视频已暂停');
    } else if (!wantsMediaPlay(goal)) {
      missing.push('暂停视频');
    }
  }
  if (wantsCloseTab(goal)) {
    if (hasPassed(input.evidence, 'tab_state', 'closed')) {
      done.push('标签已关闭');
    } else {
      missing.push('关闭标签');
    }
  }
  if (wantsContentDeliverable(goal)) {
    if (hasSubstantiveAnswer(input.answerText, goal)) {
      done.push('已带回文字结果');
    } else {
      missing.push('复制/摘录内容并回复你');
    }
  }

  // No multi-intent signals we know how to parse.
  if (done.length === 0 && missing.length === 0) {
    if (input.evidence.some(item => item.passed)) {
      return { coverage: 'unknown', done: ['已有页面核对证据'], missing: [] };
    }
    return { coverage: 'unknown', done: [], missing: [] };
  }

  if (missing.length === 0) {
    return { coverage: 'full', done, missing };
  }
  if (done.length === 0) {
    return { coverage: 'partial', done, missing };
  }
  return { coverage: 'partial', done, missing };
}
