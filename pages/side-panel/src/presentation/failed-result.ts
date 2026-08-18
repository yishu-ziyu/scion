/**
 * Failed 结果 = one human sentence + one action.
 * Goal already sits in 目标. Do not quote it again.
 * Never "模型反复失败或步数耗尽". Never an empty 结果 box.
 */

import { toProductFailureCode } from './failure-taxonomy';

export interface FailedResultView {
  sentence: string;
  action: string;
}

function isSnapshotOnly(step: string | undefined): boolean {
  return !step || step === '获取页面快照' || step === '查看页面';
}

export function deriveFailedResult(input: {
  failureCategory?: string;
  lastStepTitle?: string;
}): FailedResultView {
  const last = input.lastStepTitle?.replace(/\s+/g, ' ').trim();
  const code = toProductFailureCode(input.failureCategory);
  const category = input.failureCategory ?? '';

  if (category === 'setup_failed' || category === 'executor_start_failed') {
    return { sentence: '模型或密钥还没就绪，任务没开始做。', action: '去设置' };
  }
  if (category === 'missing_instruction') {
    return { sentence: '没有可用的任务说明，没法开始。', action: '再说一次' };
  }
  if (code === 'login_wall') {
    return { sentence: '需要你先登录或过验证。', action: '处理好了再说一次' };
  }
  if (code === 'selector_miss') {
    if (!isSnapshotOnly(last)) {
      return { sentence: `想${last}，但没找对页面上的控件。`, action: '再说一次' };
    }
    return { sentence: '没找对要点的那个控件。', action: '再说一次' };
  }
  if (code === 'false_complete') {
    return { sentence: '页面上还对不上，不能算做完。', action: '再说一次' };
  }

  if (!isSnapshotOnly(last)) {
    return { sentence: `${last}之后，还是没做成。`, action: '再说一次' };
  }
  return { sentence: '试了几轮，还是没做成。', action: '再说一次' };
}
