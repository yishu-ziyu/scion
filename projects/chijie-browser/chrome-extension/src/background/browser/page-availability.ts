/**
 * Detect dead / error destinations so URL completion cannot green-light a 404.
 * User-visible failure: YouTube playlist 404 still showed「页面地址已符合目标」.
 */

export type PageAvailabilitySnapshot = {
  url?: string;
  title?: string;
  bodyText?: string;
};

/**
 * True when the visible page is an error / unavailable shell, not a real destination.
 */
export function pageLooksUnavailable(snapshot: PageAvailabilitySnapshot): boolean {
  const title = (snapshot.title || '').replace(/\s+/g, ' ').trim();
  const body = (snapshot.bodyText || '').replace(/\s+/g, ' ').trim();
  const url = (snapshot.url || '').replace(/\s+/g, ' ').trim();
  const haystack = `${title}\n${body}`;

  if (!title && !body) return false;

  // Title-level 404 / not found (common tab titles and YouTube shells).
  if (/^\s*404(\s|$|[-–—:|])/i.test(title) || /\b404\s*not\s*found\b/i.test(title)) return true;
  if (/\b(page\s+not\s+found|not\s+found)\b/i.test(title) && /404|error|youtube|google/i.test(title + url)) {
    return true;
  }
  if (/页面不存在|找不到页面|页面无法打开/.test(title)) return true;

  // YouTube / Google soft-404 body copy (screenshot: monkey + "This page isn't available").
  if (/this page isn['’]t available/i.test(haystack)) return true;
  if (/sorry about that/i.test(haystack) && /try searching for something else/i.test(haystack)) return true;
  if (/该页面不存在|此页面不可用|找不到该网页/.test(haystack)) return true;

  // Generic HTTP error pages still on a "success-looking" host.
  if (/\b404\b/.test(title) && /not\s*found|error|错误|不存在/i.test(haystack)) return true;

  return false;
}
