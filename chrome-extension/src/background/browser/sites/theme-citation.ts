/**
 * Current-page theme + visible citation. Pure helpers so a read-only
 * summarize task can finish from page text without hunting click targets.
 */

export function instructionRequestsThemeAndCitation(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  const asksTheme =
    /核心主题|(?:概括|总结|摘要)(?:[^。！？!?]{0,8})?(?:主题|主旨)|summari[sz]e.{0,16}(?:theme|topic)/i.test(text);
  const asksCitation =
    /引用.{0,16}(?:细节|原文|正文)|正文中可见的细节|quote.{0,20}(?:visible\s+)?(?:detail|passage|body)/i.test(text);
  return asksTheme && asksCitation;
}

export function isCurrentPageThemeCitationInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!instructionRequestsThemeAndCitation(text)) return false;
  if (/打开\s*https?:\/\//i.test(text)) return false;
  if (/再打开|然后再|先确认.{0,40}再/.test(text)) return false;
  if (/多阶段|多步骤|分阶段/.test(text)) return false;
  return (
    /(?:阅读|读取|读一下)?当前(?:的)?(?:页面|网页|页)|这个(?:页面|网页)|本页/.test(text) ||
    /\b(?:this|the|current)\s+(?:page|webpage)\b/i.test(text)
  );
}

const NAV_LINE =
  /^(首页|登录|注册|菜单|导航|搜索|返回|更多|了解更多|立即开始|Get started|Sign in|Log in|Home|Menu|Search|Learn more)$/i;

function pageLines(text: string): string[] {
  return text
    .replace(/\[\d+\]<\/?[A-Za-z][^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .split(/\n+|(?<=[。！？!?])\s+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 8 && !NAV_LINE.test(line));
}

export function answerThemeAndCitationFromPage(
  pageText: string,
  title = '',
): { theme: string; quote: string; answer: string } | null {
  const titleNorm = title.replace(/\s+/g, ' ').trim();
  const lines = pageLines(pageText).filter(line => line !== titleNorm);
  const quote = lines.find(line => line.length >= 12 && line.length <= 80) ?? lines[0];
  if (!quote) return null;
  const themeSubject = quote.length > 24 ? quote.slice(0, 24) : quote;
  const theme = `核心主题：${themeSubject}`;
  return { theme, quote, answer: `${theme}\n「${quote}」` };
}
