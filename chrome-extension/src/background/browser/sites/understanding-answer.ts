/**
 * Understanding-only goals (read page, no act) need a complete path without
 * freezeable action criteria. Pure helpers for detect + answer from page facts.
 */

export function isUnderstandingOnlyInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;

  // Multi-phase / multi-step goals always need the act loop (book ch2 / product 021).
  if (
    /多阶段|多步骤|分阶段/.test(text) ||
    /[;；]\s*\S+/.test(text) ||
    /(?:^|[^\d])[1-9]\s*[)）.、]\s*\S+/.test(text) ||
    /不要在.{0,24}报完成/.test(text)
  ) {
    return false;
  }

  // Strong navigation / act verbs → not understanding-only.
  if (
    /打开\s*https?:\/\//i.test(text) ||
    /打开\s*(第一|第一个|第一行|youtube|bilibili|油管|哔哩|b站|维基|wikipedia)/i.test(text) ||
    /搜索并打开|搜索.{0,12}打开|进入.{0,12}维基|离开当前/.test(text) ||
    /点击|填写|提交|播放|暂停|滚动|搜索框|输入\s*\S+/.test(text) ||
    /\b(click|type|submit|play|pause|scroll|navigate|search\s+and\s+open)\b/i.test(text)
  ) {
    return false;
  }

  // URL/title can only prove page identity. Any request for body meaning or a
  // visible detail must go through the observe/control loop so the answer is
  // grounded in page text instead of being fabricated from metadata.
  if (
    /主题|主旨|主要内容|讲什么|文章|正文|可见.{0,8}细节|细节|首段|第一段|定义|概括|摘要|总结|观察|引用|页面内容|展示的内容/.test(
      text,
    ) ||
    /\b(?:body|content|detail|definition|first paragraph|quote|summari[sz]e|observation)\b/i.test(text)
  ) {
    return false;
  }

  const asksHomeIdentity =
    /是不是|是否|\byes\s*or\s*no\b/i.test(text) && /首页|主页|\bhome\b/i.test(text) && /bilibili|哔哩|b站/i.test(text);
  const asksSiteIdentity =
    /(?:当前(?:打开)?(?:的)?|这是)(?:哪|什么|哪个)(?:个)?(?:网站|站点)|(?:哪个|什么)(?:网站|站点)/.test(text) ||
    /识别当前(?:页|页面|网站|站点)$/.test(text);
  const asksTitleAndLocation = /标题/.test(text) && /域名|网站域名|\bhost\b|\burl\b|网址/i.test(text);

  return asksHomeIdentity || asksSiteIdentity || asksTitleAndLocation;
}

export function pageHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

export function isBilibiliHomeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!(host === 'bilibili.com' || host === 'www.bilibili.com' || host.endsWith('.bilibili.com'))) {
      return false;
    }
    return u.pathname === '/' || u.pathname === '';
  } catch {
    return false;
  }
}

/**
 * Build a short user-facing answer from live page url/title when possible.
 * Falls back to a title+host line for open-ended “what is this page”.
 */
export function answerUnderstandingFromPage(instruction: string, page: { url: string; title: string }): string {
  const host = pageHost(page.url);
  const title = (page.title || '').replace(/\s+/g, ' ').trim();
  const text = instruction.replace(/\s+/g, ' ').trim();

  // 「是不是 bilibili 首页」类
  if (
    (/是不是|是否/.test(text) || /\byes\s*or\s*no\b/i.test(text)) &&
    /bilibili|哔哩|b站/i.test(text) &&
    /首页|主页|home/i.test(text)
  ) {
    const yes = isBilibiliHomeUrl(page.url);
    return `${yes ? '是' : '否'}。host=${host}`;
  }

  // 「当前打开的是哪个网站 / 当前页是什么」
  if (/哪个网站|什么网站|当前打开|识别当前|当前页是/.test(text) && !/第一/.test(text)) {
    if (title && host) return `站点 ${host}；标题 ${title}`;
    if (host) return `站点 ${host}`;
    return title || page.url || '无法读取当前页';
  }

  // 「用一句话说明当前页标题和网站域名」
  if (/标题/.test(text) && (/域名|host|网站/.test(text) || /一句话/.test(text))) {
    return `标题：${title || '（无）'}；域名：${host || '（无）'}`;
  }

  // Generic understanding
  if (title && host) return `标题：${title}；域名：${host}`;
  if (host) return `域名：${host}`;
  return title || page.url || '无法读取当前页';
}
