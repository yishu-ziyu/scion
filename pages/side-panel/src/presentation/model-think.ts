/** Split MiniMax / reasoner `<think>` wrappers from the user-visible answer. */

export function splitModelThink(text: string): { thinking: string; visible: string; open: boolean } {
  if (!text) return { thinking: '', visible: '', open: false };

  const thinking: string[] = [];
  let visible = text;
  let open = false;

  visible = visible.replace(/<think>([\s\S]*?)<\/think>/gi, (_whole, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) thinking.push(trimmed);
    return '';
  });

  const unclosed = visible.match(/<think>([\s\S]*)$/i);
  if (unclosed && unclosed.index !== undefined) {
    const trimmed = unclosed[1]?.trim() ?? '';
    if (trimmed) thinking.push(trimmed);
    visible = visible.slice(0, unclosed.index);
    open = true;
  }

  visible = visible.replace(/[\s\S]*?<\/think>/gi, '');
  visible = visible.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  visible = visible.replace(/<\/?redacted_reasoning>/gi, '');

  return {
    thinking: thinking.join('\n\n'),
    visible: visible.trim(),
    open,
  };
}
