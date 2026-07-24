/**
 * Clean human displaySummary for ActionAttempt (Activity stream).
 * Safe for side panel: hostnames, verbs, short intents — never passwords, digests, selectors.
 */

export type AttemptDisplayInput = {
  actionName: string;
  args?: unknown;
  effectTarget?: {
    tag?: string;
    type?: string;
    role?: string;
    intent?: string;
  };
  urlOrigin?: string;
};

const MACHINE_INTENT =
  /^(perform the requested|click element|input text|control media|go to url|done|step_|act_)/i;

function readString(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    return host || undefined;
  } catch {
    const cleaned = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.trim();
    return cleaned || undefined;
  }
}

function hostFromOrigin(origin: string | undefined): string | undefined {
  if (!origin || origin === 'null') return undefined;
  return hostFromUrl(origin);
}

/** Intent is usable when short, human-ish, not a schema echo. */
export function sanitizeIntent(intent: string | undefined): string | undefined {
  const s = intent?.replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2) return undefined;
  if (s.length > 48) return `${s.slice(0, 45)}…`;
  if (MACHINE_INTENT.test(s)) return undefined;
  if (/^[a-z][a-z0-9_]+$/i.test(s) && !/[\u4e00-\u9fff]/.test(s)) return undefined;
  if (/digest|selector|xpath|pageRevision|\$\{/i.test(s)) return undefined;
  return s;
}

function fieldKindLabel(type: string | undefined, tag: string | undefined): string | undefined {
  const t = (type || '').toLowerCase();
  const g = (tag || '').toLowerCase();
  if (t === 'password') return '密码框（需你自己输入）';
  if (t === 'email') return '邮箱';
  if (t === 'search') return '搜索框';
  if (t === 'submit') return '提交按钮';
  if (g === 'textarea') return '文本框';
  if (g === 'a') return '链接';
  if (g === 'button' || t === 'button') return '按钮';
  if (g === 'video') return '视频';
  if (g === 'input') return '输入框';
  return undefined;
}

/**
 * Build a one-line Chinese (or short bilingual) summary for the Activity row.
 * Prefer concrete object; fall back to verb + host.
 */
export function buildAttemptDisplaySummary(input: AttemptDisplayInput): string {
  const name = input.actionName;
  const args = input.args;
  const intent =
    sanitizeIntent(readString(args, 'intent')) || sanitizeIntent(input.effectTarget?.intent);
  const host =
    hostFromUrl(readString(args, 'url')) || hostFromOrigin(input.urlOrigin);
  const command = readString(args, 'command');
  const keys = readString(args, 'keys');
  const scrollText = readString(args, 'text');
  const field = fieldKindLabel(input.effectTarget?.type, input.effectTarget?.tag);

  switch (name) {
    case 'go_to_url':
    case 'open_tab':
      if (host) return `打开 ${host}`;
      if (intent) return intent;
      return '打开页面';
    case 'search_google':
      return intent ? `搜索：${intent}` : '搜索网页';
    case 'switch_tab':
    case 'focus_tab':
      return host ? `切换到 ${host}` : '切换标签';
    case 'close_tab':
      return host ? `关闭 ${host}` : '关闭标签';
    case 'go_back':
      return '返回上一页';
    case 'click_element':
      if (intent) return intent.startsWith('点击') || intent.startsWith('点') ? intent : `点击${intent}`;
      if (field) return `点击${field}`;
      return '点击页面控件';
    case 'input_text':
      // Never echo typed value (may be PII).
      if (field && field.includes('密码')) return field;
      if (intent) return intent.includes('填') ? intent : `填写${intent}`;
      if (field) return `填写${field}`;
      return '填写表单';
    case 'send_keys':
      if (keys && /enter/i.test(keys)) return '按回车确认';
      if (intent) return intent;
      return '键盘输入';
    case 'control_media':
      if (command === 'play') return host ? `播放视频（${host}）` : '播放视频';
      if (command === 'pause') return host ? `暂停视频（${host}）` : '暂停视频';
      return intent || '控制媒体播放';
    case 'scroll_to_text':
      if (scrollText && scrollText.length <= 24 && !/password|token/i.test(scrollText)) {
        return `滚动到「${scrollText}」`;
      }
      return intent || '滚动页面';
    case 'scroll_to_percent':
      return intent || '滚动页面';
    case 'wait':
      return intent || '等待页面加载';
    case 'save_screenshot':
      return intent || '保存截图';
    case 'get_dropdown_options':
      return intent || '读取下拉选项';
    case 'select_dropdown_option': {
      const option = readString(args, 'text');
      if (option && option.length <= 24) return `选择「${option}」`;
      return intent || '选择下拉项';
    }
    case 'done':
      return intent || '准备交付结果';
    default:
      return intent || '执行页面操作';
  }
}

/** Optional short target chip (host or field), never a secret. */
export function buildAttemptTargetLabel(input: AttemptDisplayInput): string | undefined {
  const host =
    hostFromUrl(readString(input.args, 'url')) || hostFromOrigin(input.urlOrigin);
  if (host) return host;
  const field = fieldKindLabel(input.effectTarget?.type, input.effectTarget?.tag);
  if (field && !field.includes('密码')) return field;
  return undefined;
}
