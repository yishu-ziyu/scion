import { describe, expect, it } from 'vitest';
import { contextBlockText } from '@extension/context-engine';
import { formatTimestamp, normalizeYouTubeTimedText, parseYouTubeTranscript, type YouTubeCue } from '../src/youtube';

describe('parseYouTubeTranscript', () => {
  it('merges short cues into paragraphs with timestamp anchors', () => {
    const cues: YouTubeCue[] = [
      { start: 0.4, end: 1.2, text: 'Hello' },
      { start: 1.4, end: 2.1, text: 'there' },
      { start: 2.3, end: 3.0, text: 'friend' },
    ];
    const bundle = parseYouTubeTranscript(cues, { title: 'Talk' });
    expect(bundle.sourceType).toBe('text');
    expect(bundle.blocks).toEqual([{ type: 'paragraph', text: 'Hello there friend' }]);
    expect(bundle.anchors).toEqual([{ id: 't-400', blockIndex: 0, text: 'Hello there friend', href: '#t=0' }]);
  });

  it('breaks paragraphs at pauses and honors the max paragraph size', () => {
    const cues: YouTubeCue[] = [
      { start: 0, end: 1, text: 'One' },
      { start: 10, end: 11, text: 'Two' },
      { start: 100, end: 101, text: 'Three' },
    ];
    const bundle = parseYouTubeTranscript(cues);
    expect(bundle.blocks).toEqual([
      { type: 'paragraph', text: 'One' },
      { type: 'paragraph', text: 'Two' },
      { type: 'paragraph', text: 'Three' },
    ]);
    expect(bundle.anchors.map(a => a.href)).toEqual(['#t=0', '#t=10', '#t=100']);
  });

  it('keeps chapters as headings with time links, before their segments', () => {
    const cues: YouTubeCue[] = [
      { start: 0, end: 2, text: 'Intro text' },
      { start: 65, end: 67, text: 'Middle part' },
      { start: 120, end: 122, text: 'Ending part' },
    ];
    const bundle = parseYouTubeTranscript(cues, {
      title: 'Tutorial',
      chapters: [
        { title: '开场', start: 0 },
        { title: '正文', start: 60 },
        { title: '结尾', start: 120 },
      ],
    });
    expect(bundle.blocks[0]).toEqual({ type: 'heading', level: 2, text: '开场' });
    expect(bundle.blocks[2]).toEqual({ type: 'heading', level: 2, text: '正文' });
    expect(bundle.blocks[4]).toEqual({ type: 'heading', level: 2, text: '结尾' });
    expect(bundle.anchors[0].href).toBe('#t=0');
    expect(bundle.anchors[1].text).toBe('Intro text');
    expect(bundle.anchors.find(a => a.text === '正文')).toBeDefined();
  });

  it('builds absolute watch URLs from videoId and url metadata', () => {
    const bundle = parseYouTubeTranscript([{ start: 65.2, end: 67, text: 'Hi' }], {
      videoId: 'abc123',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    expect(bundle.anchors[0].href).toBe('https://www.youtube.com/watch?v=abc123&t=65');

    const viaUrl = parseYouTubeTranscript([{ start: 12.7, end: 14, text: 'Hi' }], {
      url: 'https://example.com/embed/xyz',
    });
    expect(viaUrl.anchors[0].href).toBe('https://example.com/embed/xyz?t=12');
  });

  it('preserves Chinese cues and removes extraction spaces', () => {
    const cues: YouTubeCue[] = [
      { start: 0, end: 1, text: '你 好' },
      { start: 1, end: 2, text: '世 界' },
    ];
    const bundle = parseYouTubeTranscript(cues);
    expect(contextBlockText(bundle.blocks[0])).toBe('你好世界');
  });

  it('drops duplicate consecutive cues', () => {
    const cues: YouTubeCue[] = [
      { start: 0, end: 1, text: 'Repeat' },
      { start: 0.2, end: 1, text: 'Repeat' },
      { start: 2.2, end: 3, text: 'Fresh' },
    ];
    const bundle = parseYouTubeTranscript(cues);
    expect(bundle.blocks).toEqual([{ type: 'paragraph', text: 'Repeat Fresh' }]);
  });

  it('returns an empty bundle when there are no usable cues', () => {
    const bundle = parseYouTubeTranscript([
      { start: 0, end: 1, text: '' },
      { start: 1, end: 2, text: '  ' },
    ]);
    expect(bundle.blocks).toEqual([]);
    expect(bundle.anchors).toEqual([]);
  });

  it('merges across medium pauses until the min length, breaks on long pauses', () => {
    const bundle = parseYouTubeTranscript(
      [
        { start: 0, end: 1, text: 'A' },
        { start: 3.5, end: 4, text: 'B' },
        { start: 10, end: 11, text: 'C' },
      ],
      {},
      { minParagraphChars: 10 },
    );
    expect(bundle.blocks).toEqual([
      { type: 'paragraph', text: 'A B' },
      { type: 'paragraph', text: 'C' },
    ]);
  });

  it('splits before exceeding maxParagraphChars', () => {
    const long = 'X'.repeat(150);
    const bundle = parseYouTubeTranscript(
      [
        { start: 0, end: 1, text: long },
        { start: 1, end: 2, text: long },
        { start: 2, end: 3, text: long },
      ],
      {},
      { maxParagraphChars: 300 },
    );
    expect(bundle.blocks).toEqual([
      { type: 'paragraph', text: long },
      { type: 'paragraph', text: long },
      { type: 'paragraph', text: long },
    ]);
  });

  it('splits a group at a chapter boundary mid-stream', () => {
    const cues: YouTubeCue[] = [
      { start: 0, end: 1, text: 'before one' },
      { start: 1, end: 2, text: 'before two' },
      { start: 60, end: 61, text: 'after one' },
    ];
    const bundle = parseYouTubeTranscript(cues, { chapters: [{ title: '第二段', start: 60 }] });
    expect(bundle.blocks[0]).toEqual({ type: 'paragraph', text: 'before one before two' });
    expect(bundle.blocks[1]).toEqual({ type: 'heading', level: 2, text: '第二段' });
    expect(bundle.blocks[2]).toEqual({ type: 'paragraph', text: 'after one' });
  });
});

describe('normalizeYouTubeTimedText', () => {
  it('parses classic timedtext XML and decodes entities', () => {
    const xml =
      '<transcript><text start="0.5" dur="3.2">Hello &amp; welcome&lt;x&gt;</text>' +
      '<text start="3.7" dur="2.0">More &#39;quotes&#39;</text></transcript>';
    expect(normalizeYouTubeTimedText(xml)).toEqual([
      { start: 0.5, end: 3.7, text: 'Hello & welcome<x>' },
      { start: 3.7, end: 5.7, text: "More 'quotes'" },
    ]);
  });

  it('parses <p> segments and strips inner markup', () => {
    const xml = '<transcript><p t="1.25" d="2">Line one\n<i>line two</i></p></transcript>';
    expect(normalizeYouTubeTimedText(xml)).toEqual([{ start: 1.25, end: 3.25, text: 'Line one line two' }]);
  });

  it('parses JSON events with segs and converts milliseconds', () => {
    const json =
      '{"events":[{"tStartMs":1500,"dDurationMs":2000,"segs":[{"utf8":"First"},{"utf8":" cue"}]},' +
      '{"tStartMs":3600,"dDurationMs":1000,"segs":[{"utf8":"Second"}]}]}';
    expect(normalizeYouTubeTimedText(json)).toEqual([
      { start: 1.5, end: 3.5, text: 'First cue' },
      { start: 3.6, end: 4.6, text: 'Second' },
    ]);
  });

  it('parses a plain JSON cue array with seconds and namespaced keys', () => {
    const json = '[{"start":2,"dur":1,"text":"One"},{"startMs":3000,"durationMs":500,"text":"Two"}]';
    expect(normalizeYouTubeTimedText(json)).toEqual([
      { start: 2, end: 3, text: 'One' },
      { start: 3, end: 3.5, text: 'Two' },
    ]);
  });

  it('sorts cues by start time', () => {
    const json = '[{"start":20,"dur":1,"text":"Later"},{"start":5,"dur":1,"text":"Earlier"}]';
    expect(normalizeYouTubeTimedText(json).map(c => c.text)).toEqual(['Earlier', 'Later']);
  });

  it('drops duplicate cues with the same text and near-identical start', () => {
    const json =
      '[{"start":1.0,"dur":1,"text":"Same"},{"start":1.1,"dur":1,"text":"Same"},{"start":5.0,"dur":1,"text":"Same"}]';
    const cues = normalizeYouTubeTimedText(json);
    expect(cues).toHaveLength(2);
    expect(cues.map(c => c.start)).toEqual([1.0, 5.0]);
  });

  it('returns [] for missing, malformed, and subtitle-less inputs', () => {
    expect(normalizeYouTubeTimedText('')).toEqual([]);
    expect(normalizeYouTubeTimedText('   \n  ')).toEqual([]);
    expect(normalizeYouTubeTimedText('<transcript></transcript>')).toEqual([]);
    expect(normalizeYouTubeTimedText('{"events":[]}')).toEqual([]);
    expect(normalizeYouTubeTimedText('{broken json')).toEqual([]);
    expect(normalizeYouTubeTimedText('plain garbage text')).toEqual([]);
    expect(normalizeYouTubeTimedText('<transcript><text start="1">  </text></transcript>')).toEqual([]);
  });

  it('handles double-encoded entities and BOM', () => {
    const xml = '<transcript><text start="0">AT&amp;amp;T &amp;lt;b&amp;gt;</text></transcript>';
    expect(normalizeYouTubeTimedText(xml)[0].text).toBe('AT&T <b>');
  });

  it('handles Chinese text without mangling it', () => {
    const xml = '<transcript><text start="0.2" dur="1">你 好 世 界</text></transcript>';
    expect(normalizeYouTubeTimedText(xml)[0].text).toBe('你好世界');
  });

  it('decodes numeric entities of any valid code point', () => {
    const xml = '<transcript><text start="0">a&#x4F60;&#22909;</text></transcript>';
    expect(normalizeYouTubeTimedText(xml)[0].text).toBe('a你好');
  });
});

describe('formatTimestamp', () => {
  it('formats seconds as mm:ss and h:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65)).toBe('01:05');
    expect(formatTimestamp(3661.9)).toBe('1:01:01');
  });
});
