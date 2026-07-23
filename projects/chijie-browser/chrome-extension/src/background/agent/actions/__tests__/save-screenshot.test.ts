import { describe, expect, it, vi } from 'vitest';
import {
  downloadJpegToDownloads,
  jpegBase64ToDataUrl,
  sanitizeScreenshotFilename,
} from '../save-screenshot';

describe('sanitizeScreenshotFilename', () => {
  it('adds .jpg and strips unsafe characters', () => {
    expect(sanitizeScreenshotFilename('my shot?.png')).toBe('my-shot-.jpg');
  });

  it('keeps a simple jpg name', () => {
    expect(sanitizeScreenshotFilename('sspai-home.jpg')).toBe('sspai-home.jpg');
  });

  it('builds a host-based default when empty', () => {
    const name = sanitizeScreenshotFilename('', 'www.sspai.com');
    expect(name.startsWith('chijie-sspai.com-')).toBe(true);
    expect(name.endsWith('.jpg')).toBe(true);
  });
});

describe('jpegBase64ToDataUrl', () => {
  it('prefixes bare base64', () => {
    expect(jpegBase64ToDataUrl('abc123')).toBe('data:image/jpeg;base64,abc123');
  });

  it('strips an existing data url prefix', () => {
    expect(jpegBase64ToDataUrl('data:image/png;base64,xyz')).toBe('data:image/jpeg;base64,xyz');
  });

  it('rejects empty input', () => {
    expect(() => jpegBase64ToDataUrl('')).toThrow(/empty_screenshot/);
  });
});

describe('downloadJpegToDownloads', () => {
  it('calls the download API with a data URL and sanitized name', async () => {
    const download = vi.fn(async () => 42);
    const result = await downloadJpegToDownloads({
      base64: 'ZmFrZQ==',
      filename: 'page shot',
      download,
    });
    expect(result).toEqual({ downloadId: 42, filename: 'page-shot.jpg' });
    expect(download).toHaveBeenCalledWith({
      url: 'data:image/jpeg;base64,ZmFrZQ==',
      filename: 'page-shot.jpg',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });
});
