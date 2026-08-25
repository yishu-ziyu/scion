/**
 * Agent decide: which webmail to open. Never default to Gmail without a name or user-confirmed host.
 */

export type MailboxOpenResult =
  | { kind: 'open'; url: string }
  | { kind: 'ask'; userVisibleText: string; pendingHost?: string }
  | { kind: 'none' };

const GOOGLE_HOST = 'mail.google.com';
const MICROSOFT_HOST = 'outlook.live.com';

const NAMED_GOOGLE = /谷歌邮箱|gmail|google\s*mail|谷歌的邮箱/i;
const NAMED_MICROSOFT = /微软邮箱|outlook|hotmail|office\s*365邮箱/i;
const ESTABLISH_GOOGLE =
  /(?:常用.{0,16}(?:谷歌|gmail|google(?:\s*mail)?)|(?:谷歌|gmail|google(?:\s*mail)?).{0,16}常用|google is my usual|usual (?:google )?mail)/i;
const ESTABLISH_MICROSOFT =
  /(?:常用.{0,16}(?:微软|outlook|microsoft|hotmail)|(?:微软|outlook|microsoft|hotmail).{0,16}常用|usual (?:outlook|microsoft))/i;
const BARE_GOOGLE = /^(?:谷歌|gmail)$/i;
const BARE_MICROSOFT = /^(?:微软|outlook|microsoft)$/i;
const REPLY_OR_OPEN_MAIL =
  /回(?:这封)?邮件|回复邮件|写邮件|打开邮箱|打开邮件|open (?:my )?e-?mail|reply to (?:this )?e-?mail/i;
const HTTP_URL = /https?:\/\/[^\s]+/i;

const WEBMAIL_HOSTS = new Set([GOOGLE_HOST, MICROSOFT_HOST, 'outlook.office.com', 'outlook.office365.com']);

export function webmailHostFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (WEBMAIL_HOSTS.has(host)) return host;
    if (host.endsWith('.mail.google.com')) return GOOGLE_HOST;
    return null;
  } catch {
    return null;
  }
}

function httpsOrigin(host: string): string {
  return `https://${host}/`;
}

/** Turn a user-written mailbox name into a webmail host. Unknown values stay trimmed. */
export function normalizeMailboxValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const asUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
  const fromUrl = webmailHostFromUrl(asUrl);
  if (fromUrl) return fromUrl;
  if (NAMED_GOOGLE.test(trimmed) || /^(?:谷歌|gmail)$/i.test(trimmed)) return GOOGLE_HOST;
  if (
    NAMED_MICROSOFT.test(trimmed) ||
    /^(?:微软|outlook|microsoft)$/i.test(trimmed) ||
    /\bmicrosoft\b/i.test(trimmed)
  ) {
    return MICROSOFT_HOST;
  }
  return trimmed;
}

export function resolveMailboxOpen(input: {
  instruction: string;
  currentUrl: string;
  confirmedHost: string | null;
  openWebmailHosts: string[];
}): MailboxOpenResult {
  const instruction = input.instruction.trim();
  if (HTTP_URL.test(instruction)) return { kind: 'none' };
  if (webmailHostFromUrl(input.currentUrl)) return { kind: 'none' };

  if (NAMED_GOOGLE.test(instruction)) return { kind: 'open', url: httpsOrigin(GOOGLE_HOST) };
  if (NAMED_MICROSOFT.test(instruction)) return { kind: 'open', url: httpsOrigin(MICROSOFT_HOST) };

  if (!REPLY_OR_OPEN_MAIL.test(instruction)) return { kind: 'none' };

  if (input.confirmedHost) return { kind: 'open', url: httpsOrigin(input.confirmedHost) };

  const openGoogle = input.openWebmailHosts.some(host => host === GOOGLE_HOST || host.endsWith('mail.google.com'));
  const openMicrosoft = input.openWebmailHosts.some(host => host.includes('outlook'));
  if (openGoogle && !openMicrosoft) {
    return {
      kind: 'ask',
      userVisibleText: '谷歌是不是你常用的邮箱？说是的话，下次我会直接打开。',
      pendingHost: GOOGLE_HOST,
    };
  }
  if (openMicrosoft && !openGoogle) {
    return {
      kind: 'ask',
      userVisibleText: '微软是不是你常用的邮箱？说是的话，下次我会直接打开。',
      pendingHost: MICROSOFT_HOST,
    };
  }

  return {
    kind: 'ask',
    userVisibleText: '要打开的是哪家网页邮箱？谷歌还是微软？',
  };
}

export function looksLikeMailboxConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (/^(?:是|对|好|要|嗯|yes|yeah|yep)[.!。！]*$/i.test(trimmed)) return true;
  return parseUsualMailboxConfirmation(trimmed).confirmed;
}

export function parseUsualMailboxConfirmation(
  text: string,
  pendingHost?: string,
): { confirmed: true; host: string } | { confirmed: false } {
  const trimmed = text.trim();
  if (pendingHost) {
    if (/^(?:是|对|好|要|嗯|yes|yeah|yep)[.!。！]*$/i.test(trimmed)) {
      return { confirmed: true, host: pendingHost };
    }
    if (/^(?:不是|不要|否|no|nope)[.!。！]*$/i.test(trimmed)) {
      return { confirmed: false };
    }
  }
  if (ESTABLISH_GOOGLE.test(trimmed) || BARE_GOOGLE.test(trimmed)) return { confirmed: true, host: GOOGLE_HOST };
  if (ESTABLISH_MICROSOFT.test(trimmed) || BARE_MICROSOFT.test(trimmed)) {
    return { confirmed: true, host: MICROSOFT_HOST };
  }
  if (pendingHost) {
    if (NAMED_GOOGLE.test(trimmed)) return { confirmed: true, host: GOOGLE_HOST };
    if (NAMED_MICROSOFT.test(trimmed)) return { confirmed: true, host: MICROSOFT_HOST };
  }
  return { confirmed: false };
}
