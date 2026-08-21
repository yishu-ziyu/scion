/**
 * User-facing result text. Acknowledgements are not results (decision 005).
 * Do not classify the instruction here — only inspect the written answer.
 */

export function isAcknowledgementOnly(summary: string): boolean {
  const s = summary.replace(/\s+/g, ' ').trim();
  return (
    /^(?:好的|好[，,]|可以[，,]|收到|明白).{0,48}(?:我来|将|正在|马上|会)/.test(s) ||
    /^(?:sure|okay|ok)[,.! ]{0,3}(?:i(?:'ll| will)|let me)/i.test(s)
  );
}

/** Empty, boilerplate complete, or a promise to work — not something the user can check. */
export function isPlaceholderDelivery(summary: string): boolean {
  const s = summary.replace(/\s+/g, ' ').trim();
  if (!s) return true;
  if (/^Control loop candidate complete$/i.test(s)) return true;
  return isAcknowledgementOnly(s);
}

export function isCompletionBoilerplate(segment: string): boolean {
  const value = segment.replace(/\s+/g, ' ').trim();
  return (
    /(?:相关工作|任务|调研|内容).{0,12}(?:已经|已)?(?:全部)?完成|请查看(?:以上|上述)信息|^这是最终结果[:：]?$/i.test(
      value,
    ) ||
    /\b(?:all|the)\s+(?:work|task|research)\s+(?:is\s+)?(?:now\s+)?complete(?:d)?\b|\bsee\s+(?:the\s+)?(?:above|previous)\s+information\b/i.test(
      value,
    )
  );
}

/** Written takeaway, not a 2-character leftover. Length must be at least 8. */
export function isBasicSubstantiveAnswer(summary: string, goalText = ''): boolean {
  const s = summary.replace(/\s+/g, ' ').trim();
  if (s.length < 8) return false;
  if (isAcknowledgementOnly(s)) return false;
  if (/^Control loop candidate complete$/i.test(s)) return false;
  if (/^(done|完成|ok|已完成|success|好了|opened|playing|paused)[.!。！]*$/i.test(s)) return false;
  if (/^(视频|媒体).{0,12}(播放|暂停|核对)/.test(s)) return false;
  if (/^(目标)?标签已关闭/.test(s)) return false;
  if (/^页面(地址|状态)已/.test(s)) return false;
  if (/^下载已(开始|完成)/.test(s)) return false;
  if (/^(Browser opened|Switched to|Playing video|Opened |Paused video)/i.test(s)) return false;
  if (/User instruction/i.test(s)) return false;
  if (isCompletionBoilerplate(s)) return false;
  const goal = goalText.replace(/\s+/g, ' ').trim();
  if (goal && (s === goal || s.includes(goal) || (s.length <= goal.length + 4 && goal.includes(s)))) return false;
  return true;
}
