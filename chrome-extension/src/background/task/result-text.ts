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
