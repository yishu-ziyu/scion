import type { ActivityIconKey } from './activity-stream';

export type IdleExample = {
  id: string;
  title: string;
  prompt: string;
  icon: ActivityIconKey;
};

/** Idle home rows. Click fills the composer. Not a Sider shopping clone. */
export const IDLE_EXAMPLES: readonly IdleExample[] = [
  {
    id: 'read-current',
    title: '读当前页',
    prompt: '读当前页，提炼关键信息，并把能核对的页面列出来',
    icon: 'globe',
  },
  {
    id: 'extract-list',
    title: '抽出列表',
    prompt: '把当前页的列表整理成表格，保留标题和原页面',
    icon: 'list',
  },
  {
    id: 'inspect-form',
    title: '检查表单',
    prompt: '列出当前页可填写的字段和现值，不修改页面',
    icon: 'check',
  },
];
