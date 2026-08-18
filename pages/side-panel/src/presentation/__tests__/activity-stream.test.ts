import { describe, expect, it } from 'vitest';
import {
  activityElapsedSeconds,
  activityIconForAction,
  activityLiveActingLine,
  activityLiveHeadline,
  activityPhaseForAttempt,
  activityToolRow,
  formatActivityDuration,
  looksLikeActionName,
  toActivityLogItem,
} from '../activity-stream';

describe('activity-stream', () => {
  it('maps actions to icon keys without leaking tool schema', () => {
    expect(activityIconForAction('go_to_url')).toBe('globe');
    expect(activityIconForAction('click_element')).toBe('click');
    expect(activityIconForAction('control_media')).toBe('play');
    expect(activityIconForAction('input_text')).toBe('type');
    expect(activityIconForAction('unknown_xyz')).toBe('generic');
    expect(activityIconForAction('observe')).toBe('eye');
    expect(activityIconForAction('snapshot')).toBe('eye');
    expect(activityIconForAction('evaluate')).toBe('eye');
    expect(activityIconForAction('find_tab')).toBe('tab');
    expect(activityIconForAction('extract_content')).toBe('list');
  });

  it('splits a host chip off the verb so the row can show icon + verb + chip', () => {
    expect(activityToolRow({ title: '打开 etsy.com', chip: 'etsy.com' })).toEqual({
      verb: '打开',
      chip: 'etsy.com',
    });
    expect(activityToolRow({ title: '填写表单', chip: undefined })).toEqual({ verb: '填写表单' });
    expect(
      toActivityLogItem(
        {
          id: 'a1',
          actionName: 'go_to_url',
          displaySummary: '打开 etsy.com',
          targetLabel: 'etsy.com',
          state: 'executing',
        },
        '打开 etsy.com',
      ),
    ).toMatchObject({ text: '打开', icon: 'globe', chip: 'etsy.com', live: true });
  });

  it('formats elapsed duration for Activity header', () => {
    expect(formatActivityDuration(45)).toBe('45s');
    expect(formatActivityDuration(120)).toBe('2m');
    expect(formatActivityDuration(125)).toBe('2m 05s');
    expect(activityElapsedSeconds({ createdAt: 1_000, endAt: 46_000 })).toBe(45);
  });

  it('prefers viewing site when no active action', () => {
    const live = activityLiveHeadline({
      status: 'running',
      siteHost: 'www.bilibili.com',
    });
    expect(live.mode).toBe('viewing');
    expect(live.icon).toBe('eye');
  });

  it('uses acting icon when an attempt is in flight', () => {
    const live = activityLiveHeadline({
      status: 'running',
      actionName: 'control_media',
      siteHost: 'bilibili.com',
    });
    expect(live.mode).toBe('acting');
    expect(live.icon).toBe('play');
  });

  it('maps attempt states to phases', () => {
    expect(activityPhaseForAttempt('executing')).toBe('acting');
    expect(activityPhaseForAttempt('observed')).toBe('done');
    expect(activityPhaseForAttempt('blocked')).toBe('waiting');
  });

  it('live acting line prefers displaySummary and never leaks actionName', () => {
    expect(
      activityLiveActingLine({
        displaySummary: '填写 Name 为 FIELD_SENTINEL_8472',
        humanActionLabel: '填写表单',
        siteHost: 'example.com',
      }),
    ).toBe('填写 Name 为 FIELD_SENTINEL_8472');
    expect(
      activityLiveActingLine({
        displaySummary: 'input_text',
        humanActionLabel: '填写表单',
        siteHost: 'example.com',
      }),
    ).toBe('正在填写表单 · example.com');
    expect(
      activityLiveActingLine({
        humanActionLabel: '点击',
        siteHost: 'www.bilibili.com',
      }),
    ).toBe('正在点击 · bilibili.com');
    expect(looksLikeActionName('control_media')).toBe(true);
    expect(looksLikeActionName('填写表单')).toBe(false);
  });
});
