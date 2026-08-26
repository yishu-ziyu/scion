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

/** Private-host SSRF guard: denied unless the user explicitly allowlisted this host. */
function firewallDeniesPrivateTarget(url: string, allowList: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.includes('://') ? url : `https://${url}`);
  } catch {
    // Invalid URL format is handled by the callers' later checks.
    return false;
  }
  const host = parsed.hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === '169.254.169.254') return true;
  if (!isPrivateOrMetadataHost(host)) return false;
  const urlWithoutProtocol = url.toLowerCase().replace(/^https?:\/\//, '');
  return !allowList.some(entry => urlWithoutProtocol === entry || host === entry || host.endsWith(`.${entry}`));
}

/**
 * Checks if a URL is allowed based on firewall configuration
 * @param url The URL to check
 * @param allowList The allow list
 * @param denyList The deny list
 * @returns True if the URL is allowed, false otherwise
 */

export function isUrlAllowed(url: string, allowList: string[], denyList: string[]): boolean {
  // Normalize and validate input
  const trimmedUrl = url.trim();
  if (trimmedUrl.length === 0) {
    return false;
  }

  const lowerCaseUrl = trimmedUrl.toLowerCase();

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

  if (DANGEROUS_PREFIXES.some(prefix => lowerCaseUrl.startsWith(prefix))) {
    return false;
  }

  // Private/local targets are denied unless the user explicitly allowlisted
  // them (local dev servers, local eval fixtures). Cloud metadata stays
  // blocked unconditionally — no legitimate workflow needs it.
  if (firewallDeniesPrivateTarget(trimmedUrl, allowList)) {
    return false;
  }

  // If firewall is disabled, allow all other URLs
  if (allowList.length === 0 && denyList.length === 0) {
    return true;
  }

  // Special case: Allow 'about:blank' explicitly
  if (trimmedUrl === 'about:blank') {
    return true;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

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
  } catch (error) {
    // Invalid URL format - deny by default
    return false;
  }
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
