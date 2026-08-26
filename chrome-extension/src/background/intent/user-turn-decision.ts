export const CHEAP_STOP_TEXT = '好的，已停止。';

const WHOLE_STOP =
  /^(?:停止|停下|停一下|取消|取消任务|停止任务|别做了|不要做了|停|stop|cancel)(?:吧|啊|呀)?[.!?。！？]*$/i;

export function isWholeStopInstruction(text: string): boolean {
  return WHOLE_STOP.test(text.replace(/\s+/g, ' ').trim());
}
