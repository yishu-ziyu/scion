/**
 * Understanding-only goals (read page, no act) need a complete path without
 * freezeable action criteria. Pure helpers for detect + answer from page facts.
 */

export function isUnderstandingOnlyInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  if (!text) return false;

  // Strong navigation / act verbs → not understanding-only.
  if (
    /打开\s*https?:\/\//i.test(text) ||
    /打开\s*(第一|第一个|第一行|youtube|bilibili|油管|哔哩|b站|维基|wikipedia)/i.test(text) ||
    /点击|填写|提交|播放|暂停|滚动|搜索框|输入\s*\S+/.test(text) ||
    /\b(click|type|submit|play|pause|scroll|navigate)\b/i.test(text)
  ) {
    return false;
  }

  return (
    /当前页|当前打开|是不是|是否|哪个网站|什么网站|说明|总结|识别|标题|域名|\bhost\b|\burl\b/i.test(
      text,
    ) || /用一句话说明/.test(text)
  );
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
export function answerUnderstandingFromPage(
  instruction: string,
  page: { url: string; title: string },
): string {
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
