/**
 * Classify createExecutor failures for TaskManager + side-panel labels.
 * Setup throws use i18n Chinese bodies (bg_setup_*), so name/token matching is required.
 */

export type CreateExecutorFailureCategory = 'setup_failed' | 'executor_start_failed';

/** Stable Error.name for missing keys / model / provider (not generic engine crash). */
export const SETUP_ERROR_NAME = 'setup_failed';

export function markSetupError(message: string): Error {
  const err = new Error(message);
  err.name = SETUP_ERROR_NAME;
  return err;
}

/**
 * Map createExecutor throw → failureCategory on the task round.
 * - setup_failed → "模型或密钥未就绪" (chat_task_fail_setup)
 * - executor_start_failed → "任务引擎启动失败" (chat_task_fail_start)
 */
export function classifyCreateExecutorError(error: unknown): CreateExecutorFailureCategory {
  if (!(error instanceof Error)) return 'executor_start_failed';
  if (error.name === SETUP_ERROR_NAME) return 'setup_failed';

  const msg = error.message;
  // Machine tokens (tests / untranslated)
  if (/noApiKeys|noNavigator|noProvider|setup_failed/i.test(msg)) return 'setup_failed';
  // Localized bg_setup_* bodies (zh shared in en/zh_CN locale files for this fork)
  if (/API\s*密钥|密钥的设置|导览代理|找不到提供者/.test(msg)) return 'setup_failed';

  return 'executor_start_failed';
}
