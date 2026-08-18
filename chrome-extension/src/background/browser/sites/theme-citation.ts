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

/**
 * "What are the videos / this page about?" Needs quotes from visible wording.
 * Not the formal theme+citation contract, and not an understanding-only identity check.
 */
export function instructionAsksPageAbout(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const about =
    /跟什么有关|讲什么|都是什么|什么主题|什么内容|主要内容是什么|是关于什么/.test(text) ||
    /\bwhat(?:'s| is| are)\s+(?:this|these|the)\b.{0,24}\babout\b/i.test(text);
  if (!about) return false;
  return (
    /(?:当前|这个|本)(?:的)?(?:页面|网页|网站)|(?:页面|网页)(?:上|中)|这些视频|首页/.test(text) ||
    /\b(?:this|the|current)\s+(?:page|webpage|site|feed)\b/i.test(text)
  );
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

const PAGE_ABOUT_CHROME = /登录后|享受更多|下载(?:客户端|APP)|打开APP|立即登录|热门推荐|个性化推荐|大会员/;

/** Visible titles/lines the user can check. Does not invent a topic category. */
export function answerPageAboutFromVisibleText(
  pageText: string,
  title = '',
): { quotes: string[]; answer: string } | null {
  const titleNorm = title.replace(/\s+/g, ' ').trim();
  const quotes = pageLines(pageText)
    .filter(line => line !== titleNorm && line.length >= 10 && line.length <= 80 && !PAGE_ABOUT_CHROME.test(line))
    .slice(0, 6);
  if (quotes.length === 0) return null;
  const quoted = quotes.map(item => `「${item}」`).join('\n');
  return {
    quotes,
    answer: quotes.length === 1 ? `核心主题：${quotes[0].slice(0, 24)}\n${quoted}` : `这些内容包括：\n${quoted}`,
  };
}

/** Keep a written theme if it exists; always attach checkable quotes from the page. */
export function mergePageAboutAnswer(modelAnswer: string, pageText: string, title = ''): string | null {
  const grounded = answerPageAboutFromVisibleText(pageText, title);
  if (!grounded) return null;
  const model = modelAnswer.replace(/\s+/g, ' ').trim();
  const modelLooksLikeResult =
    model.length >= 8 &&
    !/^(?:好的|我来|收到|ok|done|完成)[.!。！]*$/i.test(model) &&
    !/^Control loop candidate complete$/i.test(model);
  if (modelLooksLikeResult) {
    const missing = grounded.quotes.filter(quote => !modelAnswer.includes(quote));
    if (missing.length === 0) return modelAnswer.trim();
    return `${modelAnswer.trim()}\n${missing.map(quote => `「${quote}」`).join('\n')}`;
  }
  return grounded.answer;
}
