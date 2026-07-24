import { describe, expect, it } from 'vitest';
import {
  extractFirstBilibiliVideoUrlFromHtml,
  instructionRequestsFirstVideo,
  normalizeBilibiliVideoUrl,
  shouldDeterministicOpenFirstBilibiliVideo,
} from '../bilibili-first-video';

const HOME_HTML = `
<div class="bili-video-card">
  <a class="bili-video-card__image--link" href="//www.bilibili.com/video/BV1CbKb6qEze?spm=1">cover</a>
  <a class="bili-video-card__info--tit" href="//www.bilibili.com/video/BV1CbKb6qEze" title="当真相逐渐浮出水面">
    当真相逐渐浮出水面
  </a>
</div>
<div class="bili-video-card">
  <a class="bili-video-card__image--link" href="https://www.bilibili.com/video/BV15gMa6NEPG">cover2</a>
</div>
`;

describe('instructionRequestsFirstVideo', () => {
  it('matches Chinese first-row / first-video goals', () => {
    expect(instructionRequestsFirstVideo('读取当前页面，并且打开第一行第一个视频。')).toBe(true);
    expect(instructionRequestsFirstVideo('打开第一行的第一个视频')).toBe(true);
    expect(instructionRequestsFirstVideo('点击第一个视频')).toBe(true);
    expect(instructionRequestsFirstVideo('open the first video')).toBe(true);
  });

  it('rejects bare open-site goals', () => {
    expect(instructionRequestsFirstVideo('打开 bilibili')).toBe(false);
    expect(instructionRequestsFirstVideo('识别当前页')).toBe(false);
  });
});

describe('normalizeBilibiliVideoUrl', () => {
  it('normalizes protocol-relative and query forms', () => {
    expect(normalizeBilibiliVideoUrl('//www.bilibili.com/video/BV1CbKb6qEze?spm=1')).toBe(
      'https://www.bilibili.com/video/BV1CbKb6qEze',
    );
    expect(normalizeBilibiliVideoUrl('/video/BV15gMa6NEPG')).toBe(
      'https://www.bilibili.com/video/BV15gMa6NEPG',
    );
  });

  it('rejects upload / member links', () => {
    expect(normalizeBilibiliVideoUrl('//member.bilibili.com/platform/upload/video/frame')).toBeNull();
  });
});

describe('extractFirstBilibiliVideoUrlFromHtml', () => {
  it('returns the first card cover BV in document order', () => {
    expect(extractFirstBilibiliVideoUrlFromHtml(HOME_HTML)).toBe(
      'https://www.bilibili.com/video/BV1CbKb6qEze',
    );
  });

  it('returns null without video links', () => {
    expect(extractFirstBilibiliVideoUrlFromHtml('<div>no videos</div>')).toBeNull();
  });
});

describe('shouldDeterministicOpenFirstBilibiliVideo', () => {
  it('true only on list surface with first-video intent', () => {
    expect(
      shouldDeterministicOpenFirstBilibiliVideo(
        '打开第一行第一个视频',
        'https://www.bilibili.com/',
      ),
    ).toBe(true);
    expect(
      shouldDeterministicOpenFirstBilibiliVideo(
        '打开第一行第一个视频',
        'https://www.bilibili.com/video/BV1CbKb6qEze',
      ),
    ).toBe(false);
    expect(shouldDeterministicOpenFirstBilibiliVideo('打开 bilibili', 'https://www.bilibili.com/')).toBe(
      false,
    );
  });
});
