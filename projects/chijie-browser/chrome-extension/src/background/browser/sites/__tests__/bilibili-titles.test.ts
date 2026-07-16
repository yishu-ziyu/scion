import { describe, expect, it } from 'vitest';
import {
  BILI_VIDEO_CARD_TITLE_SELECTOR,
  bilibiliListSurfaceKind,
  cleanBilibiliTitles,
  enrichObserveWithBilibiliTitles,
  extractBilibiliTitlesFromHtml,
  formatBilibiliTitleEnrichment,
  isBilibiliListSurface,
  isBilibiliTitleNoise,
} from '../bilibili-titles';

/** Fixture shaped like harvest-proven homepage cards. */
const HOME_HTML = `
<div class="bili-video-card">
  <a class="bili-video-card__info--tit" title="英文版专注力测试ASMR:) 晚安" href="/video/BV1">
    <h3>英文版专注力测试ASMR:) 晚安</h3>
  </a>
</div>
<div class="bili-video-card">
  <a href="/video/BV2" class="bili-video-card__info--tit" title="盘点国足五大高光时刻，第一名载入史册">
    <h3>盘点国足五大高光时刻，第一名载入史册</h3>
  </a>
</div>
<div class="bili-video-card">
  <a class="bili-video-card__info--tit" title="《痴迷》许愿柳本身并无恶意，附身之物究竟是什么？">
    <h3>《痴迷》许愿柳本身并无恶意，附身之物究竟是什么？</h3>
  </a>
</div>
`;

const FAV_HTML = `
<div class="bili-video-card">
  <span class="bili-video-card__stats--duration">7645101:54</span>
  <a class="bili-video-card__info--tit" title="【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat">
    【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat
  </a>
  <span>4.0万3903:15</span>
</div>
`;

describe('bilibili list surface detection', () => {
  it('accepts homepage and favlist hosts', () => {
    expect(isBilibiliListSurface('https://www.bilibili.com/')).toBe(true);
    expect(isBilibiliListSurface('https://www.bilibili.com')).toBe(true);
    expect(isBilibiliListSurface('https://www.bilibili.com/favlist?fid=1')).toBe(true);
    expect(isBilibiliListSurface('https://space.bilibili.com/123/favlist')).toBe(true);
    expect(bilibiliListSurfaceKind('https://www.bilibili.com/')).toBe('home');
    expect(bilibiliListSurfaceKind('https://www.bilibili.com/favlist')).toBe('favlist');
  });

  it('rejects non-list or non-bili urls', () => {
    expect(isBilibiliListSurface('https://www.bilibili.com/video/BV1xx')).toBe(false);
    expect(isBilibiliListSurface('https://www.youtube.com/')).toBe(false);
    expect(isBilibiliListSurface(undefined)).toBe(false);
    expect(bilibiliListSurfaceKind('https://www.youtube.com/')).toBeNull();
  });
});

describe('title noise filter (harvest clean list)', () => {
  it('drops duration / playcount noise', () => {
    expect(isBilibiliTitleNoise('7645101:54')).toBe(true);
    expect(isBilibiliTitleNoise('4.0万3903:15')).toBe(true);
    expect(isBilibiliTitleNoise('3:15')).toBe(true);
    expect(isBilibiliTitleNoise('【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat')).toBe(
      false,
    );
  });

  it('cleanBilibiliTitles keeps real titles only', () => {
    expect(
      cleanBilibiliTitles([
        '7645101:54',
        '【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat',
        '4.0万3903:15',
        '【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat',
      ]),
    ).toEqual(['【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat']);
  });
});

describe('extractBilibiliTitlesFromHtml', () => {
  it('extracts homepage titles via .bili-video-card__info--tit', () => {
    expect(BILI_VIDEO_CARD_TITLE_SELECTOR).toBe('.bili-video-card__info--tit');
    const titles = extractBilibiliTitlesFromHtml(HOME_HTML);
    expect(titles).toEqual([
      '英文版专注力测试ASMR:) 晚安',
      '盘点国足五大高光时刻，第一名载入史册',
      '《痴迷》许愿柳本身并无恶意，附身之物究竟是什么？',
    ]);
  });

  it('extracts favlist title and strips stats noise', () => {
    const titles = extractBilibiliTitlesFromHtml(FAV_HTML);
    expect(titles).toEqual([
      '【为了追数学老师妹子做的AI工具】llm接入geogebra的最近一些进展 | GeoChat',
    ]);
  });

  it('returns empty without card markup', () => {
    expect(extractBilibiliTitlesFromHtml('<div>no cards</div>')).toEqual([]);
  });
});

describe('observe enrichment', () => {
  it('formats enrichment with selector hint', () => {
    const block = formatBilibiliTitleEnrichment(['标题A', '标题B'], 'home');
    expect(block).toContain('bilibili home video titles');
    expect(block).toContain(BILI_VIDEO_CARD_TITLE_SELECTOR);
    expect(block).toContain('1. 标题A');
    expect(block).toContain('2. 标题B');
  });

  it('enrichObserveWithBilibiliTitles only on list surfaces', () => {
    const home = enrichObserveWithBilibiliTitles('https://www.bilibili.com/', HOME_HTML);
    expect(home).toContain('英文版专注力测试ASMR:) 晚安');
    expect(home).toContain(BILI_VIDEO_CARD_TITLE_SELECTOR);

    const fav = enrichObserveWithBilibiliTitles('https://www.bilibili.com/favlist?fid=1', FAV_HTML);
    expect(fav).toContain('GeoChat');
    expect(fav).not.toContain('7645101:54');

    expect(enrichObserveWithBilibiliTitles('https://www.bilibili.com/video/BV1', HOME_HTML)).toBe('');
    expect(enrichObserveWithBilibiliTitles('https://www.bilibili.com/', '')).toBe('');
  });
});
