function isPrivateOrMetadataHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host === '169.254.169.254') {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function hostFromAllowEntry(entry: string): string {
  const trimmed = entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end > 1) return trimmed.slice(1, end);
  }
  const hostPort = trimmed.split('/')[0] ?? '';
  const ipv4 = hostPort.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (ipv4) return ipv4[1];
  const colon = hostPort.indexOf(':');
  return colon === -1 ? hostPort : hostPort.slice(0, colon);
}

function isPrivateAllowEntry(entry: string): boolean {
  return isPrivateOrMetadataHost(hostFromAllowEntry(entry));
}

/** Private-host SSRF guard: denied unless the user explicitly allowlisted this host. */
function firewallDeniesPrivateTarget(parsedUrl: URL, rawUrl: string, allowList: string[]): boolean {
  const host = parsedUrl.hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === '169.254.169.254') return true;
  if (!isPrivateOrMetadataHost(host)) return false;
  const urlWithoutProtocol = rawUrl.toLowerCase().replace(/^https?:\/\//, '');
  return !allowList.some(entry => urlWithoutProtocol === entry || host === entry || host.endsWith(`.${entry}`));
}

export type UrlAllowOptions = {
  /**
   * The tab is already open (user or a previous navigation). Bind/observe must
   * not treat a local page the user is looking at as a navigation SSRF.
   */
  existingTab?: boolean;
};

/**
 * Checks if a URL is allowed based on firewall configuration
 * @param url The URL to check
 * @param allowList The allow list
 * @param denyList The deny list
 * @returns True if the URL is allowed, false otherwise
 */

export function isUrlAllowed(url: string, allowList: string[], denyList: string[], options?: UrlAllowOptions): boolean {
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return false;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return false;
  }

  // about:blank is the sole non-HTTP bootstrap URL.
  if (trimmedUrl === 'about:blank') {
    return true;
  }

  // URL parsing strips TAB/LF/CR from schemes. Check the parsed protocol so
  // obfuscated javascript:, data:, file:, and similar URLs cannot bypass this guard.
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return false;
  }

  const lowerCaseUrl = trimmedUrl.toLowerCase();
  const normalizedLowerCaseUrl = parsedUrl.href.toLowerCase();

  // ALWAYS block dangerous/forbidden URLs, even if firewall is disabled
  const DANGEROUS_PREFIXES = [
    'https://chromewebstore.google.com', // scripts are not allowed to be injected into chrome web store
    'chrome-extension://',
    'chrome://',
    'javascript:',
    'data:',
    'file:',
    'vbscript:',
    'ws:',
    'wss:',
  ];

  if (DANGEROUS_PREFIXES.some(prefix => normalizedLowerCaseUrl.startsWith(prefix))) {
    return false;
  }

  // Private/local targets are denied unless the user explicitly allowlisted
  // them (local dev servers, local eval fixtures). An already-open tab is
  // user-initiated — bind and fill it. Cloud metadata stays blocked.
  if (!options?.existingTab && firewallDeniesPrivateTarget(parsedUrl, trimmedUrl, allowList)) {
    return false;
  }
  const host = parsedUrl.hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === '169.254.169.254') {
    return false;
  }

  // Allowlisting 127.0.0.1 is an SSRF exception, not an exclusive public
  // whitelist. Exclusive matching starts only when a public host is listed.
  const publicAllowList = allowList.filter(entry => !isPrivateAllowEntry(entry));
  if (publicAllowList.length === 0 && denyList.length === 0) {
    return true;
  }

  // 1. Remove protocol prefix for further comparisons
  const urlWithoutProtocol = lowerCaseUrl.replace(/^https?:\/\//, '');

  // 2. First check full URL against deny list
  for (const deniedEntry of denyList) {
    if (urlWithoutProtocol === deniedEntry) {
      return false;
    }
  }

  // 3. Check full URL against allow list
  for (const allowedEntry of allowList) {
    if (urlWithoutProtocol === allowedEntry) {
      return true;
    }
  }

  // 4. Extract domain for domain-based checks
  let domain = parsedUrl.hostname.toLowerCase();

  // Remove port number if present
  const portIndex = domain.indexOf(':');
  if (portIndex > -1) {
    domain = domain.substring(0, portIndex);
  }

  // 5. Check domain against deny list
  for (const deniedEntry of denyList) {
    if (domain === deniedEntry || domain.endsWith(`.${deniedEntry}`)) {
      return false;
    }
  }

  // 6. Check domain against allow list
  for (const allowedEntry of allowList) {
    if (domain === allowedEntry || domain.endsWith(`.${allowedEntry}`)) {
      return true;
    }
  }

  // Default policy
  return allowList.length === 0;
}

// Check if a URL is a new tab page (about:blank or chrome://new-tab-page).
export function isNewTabPage(url: string): boolean {
  return url === 'about:blank' || url === 'chrome://new-tab-page' || url === 'chrome://new-tab-page/';
}

export function capTextLength(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + '...';
  }
  return text;
}
