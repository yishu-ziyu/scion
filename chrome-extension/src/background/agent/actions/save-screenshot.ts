/**
 * Pure helpers for save_screenshot: filename sanitization + data-URL download.
 * Keep free of Puppeteer so unit tests stay node-friendly.
 */

export function sanitizeScreenshotFilename(raw: string | undefined | null, hostHint = 'page'): string {
  const base =
    (raw ?? '')
      .trim()
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 80) || '';

  let name = base;
  if (!name) {
    const host = hostHint
      .replace(/^www\./i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    name = `chijie-${host || 'page'}-${stamp}`;
  }

  if (!/\.jpe?g$/i.test(name)) {
    name = `${name.replace(/\.[a-z0-9]+$/i, '')}.jpg`;
  }
  return name;
}

export function jpegBase64ToDataUrl(base64: string): string {
  const cleaned = base64.replace(/^data:image\/\w+;base64,/, '').trim();
  if (!cleaned) {
    throw new Error('empty_screenshot');
  }
  return `data:image/jpeg;base64,${cleaned}`;
}

export type DownloadFn = (options: chrome.downloads.DownloadOptions) => Promise<number>;

export async function downloadJpegToDownloads(input: {
  base64: string;
  filename: string;
  download?: DownloadFn;
}): Promise<{ downloadId: number; filename: string }> {
  const filename = sanitizeScreenshotFilename(input.filename);
  const url = jpegBase64ToDataUrl(input.base64);
  const download =
    input.download ??
    ((options: chrome.downloads.DownloadOptions) =>
      new Promise<number>((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.downloads?.download) {
          reject(new Error('downloads_api_unavailable'));
          return;
        }
        chrome.downloads.download(options, id => {
          const err = chrome.runtime?.lastError;
          if (err?.message) {
            reject(new Error(err.message));
            return;
          }
          if (typeof id !== 'number') {
            reject(new Error('download_id_missing'));
            return;
          }
          resolve(id);
        });
      }));

  const downloadId = await download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  return { downloadId, filename };
}
