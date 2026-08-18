import { describe, expect, it } from 'vitest';
import {
  extractFirstBilibiliVideoUrlFromHtml,
  instructionNamesSpecificBilibiliCreator,
  instructionRequestsFirstVideo,
  instructionRequestsOpenBilibiliVideo,
  judgeBilibiliWatchComplete,
  normalizeBilibiliVideoUrl,
  pickNewerBilibiliWatchTab,
  shouldDeterministicOpenFirstBilibiliVideo,
  shouldKeepAdoptedBilibiliWatch,
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

  it('does not open homepage first card when the goal names a UP', () => {
    expect(instructionNamesSpecificBilibiliCreator('打开B站，点开老番茄的第一个视频')).toBe(true);
    expect(instructionRequestsFirstVideo('打开B站，点开老番茄的第一个视频')).toBe(true);
    expect(
      shouldDeterministicOpenFirstBilibiliVideo(
        '打开B站，点开老番茄的第一个视频',
        'https://www.bilibili.com/',
      ),
    ).toBe(false);
    expect(
      shouldDeterministicOpenFirstBilibiliVideo('打开第一行第一个视频', 'https://www.bilibili.com/'),
    ).toBe(true);
    expect(
      shouldDeterministicOpenFirstBilibiliVideo('打开第一行的第一个视频', 'https://www.bilibili.com/'),
    ).toBe(true);
  });
});

describe('judgeBilibiliWatchComplete', () => {
  const instruction = '打开b站，搜索绝命墨菲，然后点击第一行的第二个视频';
  const title = '《传教士》第5期：圣杀者领取追杀令，上帝视频通话小镇！【墨菲】_哔哩哔哩_bilibili';
  const watch = 'https://www.bilibili.com/video/BV1kguq6YEN6/';

  it('matches a second-row click as an open-video goal', () => {
    expect(instructionRequestsOpenBilibiliVideo(instruction)).toBe(true);
  });

  it('hands back the visible title once the watch page is open', () => {
    expect(judgeBilibiliWatchComplete(instruction, watch, title)).toBe(
      '已打开「《传教士》第5期：圣杀者领取追杀令，上帝视频通话小镇！【墨菲】」',
    );
  });

  it('hands back the BV when the tab title is still generic', () => {
    expect(judgeBilibiliWatchComplete(instruction, watch, '哔哩哔哩')).toBe('已打开「BV1kguq6YEN6」');
  });

  it('does not finish on the search list', () => {
    expect(
      judgeBilibiliWatchComplete(
        instruction,
        'https://search.bilibili.com/all?keyword=%E7%BB%9D%E5%91%BD%E5%A2%A8%E8%8F%B2',
        '绝命墨菲-哔哩哔哩_bilibili',
      ),
    ).toBeNull();
  });
});

describe('pickNewerBilibiliWatchTab', () => {
  it('adopts a watch tab opened after the search list', () => {
    expect(
      pickNewerBilibiliWatchTab(
        { id: 1, url: 'https://search.bilibili.com/all?keyword=x', lastAccessed: 10 },
        [
          { id: 1, url: 'https://search.bilibili.com/all?keyword=x', lastAccessed: 10 },
          { id: 2, url: 'https://www.bilibili.com/video/BV1kguq6YEN6/', lastAccessed: 20 },
        ],
      ),
    ).toBe(2);
  });

  it('keeps an older leftover watch tab from stealing a new search', () => {
    expect(
      pickNewerBilibiliWatchTab(
        { id: 1, url: 'https://search.bilibili.com/all?keyword=x', lastAccessed: 30 },
        [
          { id: 1, url: 'https://search.bilibili.com/all?keyword=x', lastAccessed: 30 },
          { id: 2, url: 'https://www.bilibili.com/video/BV1oldxxxx01/', lastAccessed: 5 },
        ],
      ),
    ).toBeNull();
  });

  it('does not leave a watch page to probe the search list', () => {
    expect(
      shouldKeepAdoptedBilibiliWatch(
        'https://www.bilibili.com/video/BV1kguq6YEN6/',
        'https://search.bilibili.com/all?keyword=x',
      ),
    ).toBe(true);
    expect(
      shouldKeepAdoptedBilibiliWatch(
        'https://search.bilibili.com/all?keyword=x',
        'https://search.bilibili.com/all?keyword=x',
      ),
    ).toBe(false);
  });
});
