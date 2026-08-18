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
    id: 'open',
    title: '打开页面',
    prompt: '打开这个网址，告诉我现在在哪',
    icon: 'globe',
  },
  {
    id: 'extract',
    title: '抽出表格',
    prompt: '把当前页的列表抽成一张表，做完能核对',
    icon: 'list',
  },
  {
    id: 'finish',
    title: '读完再回',
    prompt: '打开链接，读关键信息，交出能核对的结果',
    icon: 'check',
  },
];
