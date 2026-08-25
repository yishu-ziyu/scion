import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { closeAttachmentMenuOnEscape } from '../../components/ChatInput';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => readFileSync(resolve(here, relativePath), 'utf8');

const chatInput = source('../../components/ChatInput.tsx');
const progressOverview = source('../../components/TaskProgressOverview.tsx');
const workStream = source('../../components/WorkStream.tsx');
const messageList = source('../../components/MessageList.tsx');
const chatHistory = source('../../components/ChatHistoryList.tsx');
const bookmarkList = source('../../components/BookmarkList.tsx');
const componentsCss = source('../chijie-components.css');
const tokensCss = source('../chijie-tokens.css');
const sidePanelCss = source('../../SidePanel.css');
const sidePanel = source('../../SidePanel.tsx');

function tokenHex(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`Missing color token ${name}`);
  return match[1];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map(channel => Number.parseInt(channel, 16) / 255)
      .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe('final side-panel accessibility gates', () => {
  it('returns attachment-menu focus to the trigger on Escape', () => {
    expect(chatInput).toContain('attachmentTriggerRef');
    expect(chatInput).toContain("if (event.key !== 'Escape') return false");
    expect(chatInput).toContain('event.preventDefault()');
    expect(chatInput).toContain('attachmentTriggerRef.current?.focus()');
    expect(chatInput).toContain('aria-haspopup="menu"');

    const preventDefault = vi.fn();
    const closeMenu = vi.fn();
    const restoreFocus = vi.fn();
    expect(closeAttachmentMenuOnEscape({ key: 'Enter', preventDefault }, closeMenu, restoreFocus)).toBe(false);
    expect(closeAttachmentMenuOnEscape({ key: 'Escape', preventDefault }, closeMenu, restoreFocus)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it('keeps unsent instructions in the composer and explains the failed delivery', () => {
    expect(chatInput).toContain('const result = await onSendMessage(messageContent, displayContent);');
    expect(chatInput).toContain('if (!shouldClearComposerAfterDelivery(result))');
    expect(chatInput).toContain('setDeliveryFeedback(result.feedback');
    expect(chatInput).toContain('data-testid="goal-send-feedback"');
    expect(chatInput).toContain('role="alert"');
    expect(sidePanel).toContain("feedback: '上一个任务还在启动。输入已保留，请稍后再试。'");
  });

  it('gives the live stream a thinking fold and a takeover control', () => {
    expect(workStream).toContain('chat_task_thinking_heading');
    expect(workStream).toContain('chat_task_takeover');
    expect(workStream).toContain('data-testid="live-stop-generating"');
  });

  it('keeps visible health time outside a semantic-only live announcer', () => {
    expect(progressOverview).toContain('data-testid="task-health-announcer"');
    expect(progressOverview).toContain('role="status"');
    expect(progressOverview).toContain('key={`${view.health.state}:${view.health.summary}`}');
    expect(progressOverview).toContain('healthAnnouncement(view.health)');
    expect(progressOverview).not.toMatch(/key=\{`\$\{now\}/);
  });

  it('keeps advancing health text at AA contrast and action icons above 3:1', () => {
    expect(contrastRatio(tokenHex('--chijie-paper-muted'), tokenHex('--chijie-accent-subtle'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(tokenHex('--chijie-accent'), tokenHex('--chijie-surface'))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokenHex('--chijie-danger'), tokenHex('--chijie-surface'))).toBeGreaterThanOrEqual(3);
    expect(componentsCss).toMatch(
      /data-health='advancing'[\s\S]{0,240}chijie-progress-health-time[\s\S]{0,80}var\(--chijie-paper-muted\)/,
    );
  });

  it('keeps disclosures and bookmark/history actions at least 40px and keyboard-visible', () => {
    expect(messageList).toContain('min-h-10 min-w-10');
    expect(chatHistory.match(/size-10/g)).toHaveLength(2);
    expect(bookmarkList.match(/size-10/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(chatHistory).toContain('focus-visible:opacity-100');
    expect(bookmarkList).toContain('focus-visible:opacity-100');
    expect(componentsCss).toContain('button:focus-visible');
  });

  it('uses only Chijie colors for history and bookmark chrome', () => {
    const bannedPalette = /(?:bg|text|border)-(?:sky|slate|gray|white)(?:[/-]|\b)/;
    expect(chatHistory).not.toMatch(bannedPalette);
    expect(bookmarkList).not.toMatch(bannedPalette);
    expect(chatHistory).toContain('text-[var(--chijie-accent)]');
    expect(bookmarkList).toContain('text-[var(--chijie-danger)]');
  });

  it('supports 200% and low-height reflow without hiding card, chat, or composer', () => {
    expect(sidePanelCss).toContain('@media (max-height: 560px), (max-width: 280px)');
    expect(sidePanelCss).toMatch(/\.chijie-shell > \.chijie-shell[\s\S]{0,180}overflow-y:\s*auto !important/);
    expect(sidePanelCss).toMatch(/\.chijie-workspace[\s\S]{0,100}overflow:\s*visible/);
    expect(sidePanelCss).toMatch(/\.chijie-chat-log[\s\S]{0,140}min-height:\s*6\.5rem/);
    expect(sidePanelCss).toMatch(/\.chijie-composer[\s\S]{0,100}position:\s*sticky/);
    expect(sidePanelCss).toContain('@media (max-width: 300px)');
    expect(sidePanelCss).toMatch(/\.header[\s\S]{0,80}flex-wrap:\s*wrap/);
    expect(sidePanelCss).toMatch(/\.header-icons[\s\S]{0,120}flex-wrap:\s*wrap/);
    expect(sidePanelCss).toMatch(/\.chijie-header-logo[\s\S]{0,120}max-width:\s*100%/);
  });

  it('keeps compact supporting text readable and attachment controls rigid', () => {
    expect(componentsCss).toMatch(/\.chijie-progress-direction-change[\s\S]{0,300}font-size:\s*11px/);
    expect(componentsCss).toMatch(/\.chijie-progress-milestone-summary[\s\S]{0,120}font-size:\s*12px/);
    expect(componentsCss).toMatch(/\.chijie-stream-caption[\s\S]{0,120}var\(--chijie-muted\)/);
    expect(componentsCss).toMatch(/\.chijie-prompt-chip-remove[\s\S]{0,180}flex-basis:\s*40px/);
    expect(componentsCss).toMatch(/\.chijie-prompt-menu small[\s\S]{0,120}font-size:\s*11px/);
  });

  it('disables every Skill launch control while another launch owns the console', () => {
    expect(sidePanel).toContain('skillRunDisabled={taskLaunchPending}');
    expect(bookmarkList).toContain('disabled={skillRunDisabled}');
    expect(bookmarkList).toContain('aria-busy={skillRunDisabled}');
    expect(bookmarkList).toContain('if (skillRunDisabled) return');
  });
});
