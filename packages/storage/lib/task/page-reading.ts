/** Generic loop/UI noise. A real page reading is a short human sentence. */
const PAGE_READING_NOISE =
  /^(思考中|获取页面快照|查看页面|推进当前任务|已按步骤做完|正在处理|正在操作页面|在想下一步|正在看\s|page_state)$/;

export function isHumanPageReading(value: string | undefined): boolean {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (text.length < 2) return false;
  if (PAGE_READING_NOISE.test(text)) return false;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text) && !/[\u4e00-\u9fff]/.test(text)) return false;
  return true;
}

export function compactPageReading(value: string, max = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}
