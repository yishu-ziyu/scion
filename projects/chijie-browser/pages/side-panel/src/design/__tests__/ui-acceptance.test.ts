/**
 * BDD acceptance tests for side-panel UI redesign.
 * Red → green under TDD. Do not weaken assertions to match old sky-blue chrome.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  YISHU_TOKEN_NAMES,
  completionVisibleText,
  statusLabelKey,
  taskCardClassName,
  primaryButtonClassName,
  shellClassName,
  welcomeClassName,
  welcomeCardClassName,
  optionsLayoutClassName,
  optionsNavClassName,
  optionsMainClassName,
  stylesUseBoxShadow,
  sourceHasBannedSkyChrome,
} from '../contracts';
import { t } from '@extension/i18n';
import {
  approvalActionLabel,
  humanApprovalSummary,
  instructionToSkillTemplate,
} from '../../components/TaskStatusCard';
import { commandRejectionMessage } from '../../SidePanel';

// Ready/dev i18n resolves via t.devLocale, not chrome.i18n. Pin zh_CN so
// product-copy assertions stay stable on English host machines.
t.devLocale = 'zh_CN';

vi.stubGlobal('chrome', {
  i18n: {
    getMessage: (key: string) => {
      t.devLocale = 'zh_CN';
      return t(key as Parameters<typeof t>[0]);
    },
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(here, '../chijie-tokens.css'), 'utf8');
const componentsCss = readFileSync(resolve(here, '../chijie-components.css'), 'utf8');
const taskStatusCardSource = readFileSync(resolve(here, '../../components/TaskStatusCard.tsx'), 'utf8');
const sidePanelSource = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
const sidePanelCss = readFileSync(resolve(here, '../../SidePanel.css'), 'utf8');
const indexCss = readFileSync(resolve(here, '../../index.css'), 'utf8');
const optionsRoot = resolve(here, '../../../../options/src');
const optionsTsx = readFileSync(resolve(optionsRoot, 'Options.tsx'), 'utf8');
const optionsIndexCss = readFileSync(resolve(optionsRoot, 'index.css'), 'utf8');
const optionsCss = readFileSync(resolve(optionsRoot, 'Options.css'), 'utf8');
const optionsTokensCss = readFileSync(resolve(optionsRoot, 'design/chijie-tokens.css'), 'utf8');
const optionsComponentsCss = readFileSync(resolve(optionsRoot, 'design/chijie-components.css'), 'utf8');
const firewallSettings = readFileSync(resolve(optionsRoot, 'components/FirewallSettings.tsx'), 'utf8');
const analyticsSettings = readFileSync(resolve(optionsRoot, 'components/AnalyticsSettings.tsx'), 'utf8');
const modelSettings = readFileSync(resolve(optionsRoot, 'components/ModelSettings.tsx'), 'utf8');

describe('Feature: Side panel uses 持节 design system', () => {
  describe('Scenario: Design tokens are the only color source for the shell', () => {
    it('defines required CSS custom properties from DESIGN.md', () => {
      for (const name of YISHU_TOKEN_NAMES) {
        expect(tokensCss, `missing token ${name}`).toContain(`${name}:`);
      }
      expect(tokensCss).toMatch(/--chijie-background:\s*#f5f7f5/i);
      expect(tokensCss).toMatch(/--chijie-paper:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-accent:\s*#176c52/i);
      expect(tokensCss).toMatch(/--chijie-surface:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-foreground:\s*#16231f/i);
      expect(tokensCss).toMatch(/--chijie-warning:\s*#93641a/i);
    });

    it('exposes paper-card and pill-button class contracts', () => {
      expect(taskCardClassName).toBe('chijie-paper-card');
      expect(primaryButtonClassName).toBe('chijie-btn-primary');
      expect(componentsCss).toContain('.chijie-paper-card');
      expect(componentsCss).toContain('.chijie-btn-primary');
      expect(componentsCss).toMatch(/border-radius:\s*var\(--chijie-radius-pill\)/);
      expect(tokensCss).toMatch(/--chijie-radius-pill:\s*999px/);
      expect(tokensCss).toMatch(/--chijie-radius-xl:\s*16px/);
    });
  });

  describe('Scenario: No drop shadows on task chrome', () => {
    it('does not use box-shadow in yishu component styles', () => {
      expect(stylesUseBoxShadow(componentsCss)).toBe(false);
    });

    it('keeps keyboard focus visible and honors reduced motion', () => {
      expect(componentsCss).toContain(':focus-visible');
      expect(componentsCss).toContain('@media (prefers-reduced-motion: reduce)');
      expect(componentsCss).toMatch(/scroll-behavior:\s*auto\s*!important/);
    });
  });

  describe('Scenario: Status card speaks human language', () => {
    it('maps machine statuses to i18n keys, not raw enums as the only output', () => {
      expect(statusLabelKey('running')).toBe('chat_task_status_running');
      expect(statusLabelKey('waiting_approval')).toBe('chat_task_status_waiting_approval');
      expect(statusLabelKey('completed')).toBe('chat_task_status_completed');
      expect(statusLabelKey('failed')).toBe('chat_task_status_failed');
    });
  });

  describe('Scenario: Completion is plain language, not a receipt id', () => {
    it('builds visible completion copy without receipt: prefix or raw uuid shape', () => {
      const text = completionVisibleText({
        doneTitle: '已完成',
        doneBody: '页面结果已核对通过，可以放心结束这一步。',
        receiptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });
      expect(text).toContain('已完成');
      expect(text).toContain('页面结果已核对通过');
      expect(text).not.toMatch(/receipt:/i);
      expect(text).not.toContain('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });
  });

  describe('Scenario: Skill template prefilled from last goal', () => {
    it('replaces FIELD_* sentinels with {{name}}', () => {
      expect(
        instructionToSkillTemplate(
          'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
        ),
      ).toBe('Fill Name with {{name}} and submit; success is Saved successfully.');
    });
  });

  describe('Scenario: Waiting for approval uses vertical primary layout contract', () => {
    it('task actions container is a column flex class', () => {
      const block = componentsCss.slice(componentsCss.indexOf('.chijie-action-stack'));
      expect(block).toContain('.chijie-action-stack');
      expect(block.slice(0, 200)).toContain('flex-direction: column');
    });

    it('hides generic executor prose while preserving specific human detail', () => {
      expect(humanApprovalSummary('Perform the requested external action')).toBeNull();
      expect(humanApprovalSummary('将发布这条评论')).toBe('将发布这条评论');
    });

    it('describes approval without assuming every external action is a form submission', () => {
      expect(
        approvalActionLabel(
          { actionName: 'click_element', effect: 'external_commit' } as Parameters<typeof approvalActionLabel>[0],
          'Perform the requested external action',
        ),
      ).toBe('执行一次页面确认操作');
      expect(approvalActionLabel(undefined, '将删除这条记录')).toBe('将删除这条记录');
    });

    it('turns rejected command enums into user-facing recovery copy', () => {
      expect(commandRejectionMessage('stale_revision')).not.toContain('stale_revision');
      expect(commandRejectionMessage('invalid_transition')).not.toContain('invalid_transition');
      expect(sidePanelSource).not.toContain('Command rejected:');
    });
  });

  describe('Scenario: Components bind to yishu classes (not stock sky chrome)', () => {
    it('TaskStatusCard uses paper card + primary pill + action stack contracts', () => {
      expect(taskStatusCardSource).toContain("from '../design/contracts'");
      expect(taskStatusCardSource).toContain('taskCardClassName');
      expect(taskStatusCardSource).toContain('primaryButtonClassName');
      expect(taskStatusCardSource).toContain('actionStackClassName');
      expect(taskStatusCardSource).toContain('statusLabelKey');
      expect(taskStatusCardSource).toContain('completionVisibleText');
      // stock tailwind sky primary is banned on this card
      expect(taskStatusCardSource).not.toMatch(/bg-sky-600/);
      expect(taskStatusCardSource).not.toMatch(/bg-emerald-100/);
      // contracts still resolve to design class strings
      expect(taskCardClassName).toBe('chijie-paper-card');
      expect(primaryButtonClassName).toBe('chijie-btn-primary');
    });

    it('SidePanel shell imports yishu styles and uses shell class', () => {
      expect(indexCss).toMatch(/chijie-tokens\.css/);
      expect(indexCss).toMatch(/chijie-components\.css/);
      expect(sidePanelSource).toContain(shellClassName);
    });
  });

  describe('Scenario: Welcome empty state uses 持节 paper card (not sky chrome)', () => {
    it('binds welcome block to yishu classes and drops sky utilities', () => {
      expect(sidePanelSource).toContain(welcomeClassName);
      expect(sidePanelSource).toContain(welcomeCardClassName);
      expect(sidePanelSource).toContain(primaryButtonClassName);
      expect(componentsCss).toContain('.chijie-welcome-card');
      expect(componentsCss).toMatch(/\.chijie-welcome-card[\s\S]*?border-radius:\s*var\(--chijie-radius-xl\)/);
      // welcome region must not use stock sky chrome
      const welcomeSlice = sidePanelSource.slice(
        sidePanelSource.indexOf('hasConfiguredModels === false'),
        sidePanelSource.indexOf('hasConfiguredModels === true'),
      );
      expect(welcomeSlice.length).toBeGreaterThan(50);
      expect(welcomeSlice).not.toMatch(/text-sky-/);
      expect(welcomeSlice).not.toMatch(/bg-sky-/);
      expect(welcomeSlice).not.toMatch(/border-sky-/);
    });
  });

  describe('Scenario: Options settings page uses 持节 shell (not sky chrome)', () => {
    it('imports tokens and uses options layout contracts', () => {
      expect(optionsIndexCss).toMatch(/chijie-tokens\.css/);
      expect(optionsIndexCss).toMatch(/chijie-components\.css/);
      expect(optionsTokensCss).toMatch(/--chijie-background:\s*#000000/i);
      expect(optionsTokensCss).toMatch(/--chijie-accent:\s*#e35342/i);
      expect(optionsComponentsCss).toContain('.chijie-options-layout');
      expect(optionsComponentsCss).toContain('.chijie-options-nav');
      expect(optionsTsx).toContain(optionsLayoutClassName);
      expect(optionsTsx).toContain(optionsNavClassName);
      expect(optionsTsx).toContain(optionsMainClassName);
      expect(sourceHasBannedSkyChrome(optionsTsx)).toBe(false);
      expect(optionsTsx).not.toMatch(/bg-sky-/);
      expect(optionsTsx).not.toContain('#0EA5E9');
      expect(stylesUseBoxShadow(optionsComponentsCss)).toBe(false);
    });

    it('settings controls do not use stock blue as primary chrome', () => {
      expect(firewallSettings).not.toMatch(/bg-blue-500|bg-blue-600/);
      expect(analyticsSettings).not.toMatch(/bg-blue-500|bg-blue-600/);
      expect(modelSettings).not.toMatch(/bg-blue-600|bg-blue-100|text-blue-800|border-blue-/);
      expect(optionsCss).not.toMatch(/#7dd3fc|#e2e8f0|#1e293b/);
    });
  });

  describe('Scenario: SidePanel.css has no legacy sky scrollbar/header chrome', () => {
    it('uses chijie tokens instead of sky/slate palette', () => {
      expect(sidePanelCss).not.toMatch(/#0ea5e9/i);
      expect(sidePanelCss).not.toMatch(/#19C2FF/i);
      expect(sidePanelCss).not.toMatch(/#7dd3fc/i);
      expect(sidePanelCss).not.toMatch(/#38bdf8/i);
      expect(sidePanelCss).toMatch(/--chijie-/);
    });
  });

  describe('Scenario: Chat timeline is human-facing (no Planner/step_failed labels)', () => {
    it('MessageList humanizes messages and does not render ACTOR_PROFILES English names', () => {
      const messageList = readFileSync(resolve(here, '../../components/MessageList.tsx'), 'utf8');
      expect(messageList).toContain('humanizeStoredMessage');
      expect(messageList).not.toContain('ACTOR_PROFILES');
      expect(messageList).not.toContain('actor.name');
      const sidePanel = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
      expect(sidePanel).toContain('classifyAgentEvent');
    });

    it('uses a real activity indicator instead of an invented progress bar', () => {
      const messageList = readFileSync(resolve(here, '../../components/MessageList.tsx'), 'utf8');
      expect(taskStatusCardSource).not.toContain('chijie-progress-track');
      expect(taskStatusCardSource).not.toContain('progressPct');
      expect(messageList).not.toContain('animate-progress');
      expect(messageList).toContain('chijie-current-activity');
    });

    it('keeps the active composer available and renders one stop control', () => {
      expect(sidePanelSource).toContain("const busy = taskSnapshot.status === 'waiting_approval'");
      expect(sidePanelSource).toContain('showStopButton={false}');
      expect(sidePanelSource).toContain('data-task-active={showStopButton');
      expect(sidePanelSource).toContain('data-testid="empty-composer-spacer"');
    });

    it('removes upstream promotion surfaces from the product shell', () => {
      expect(sidePanelSource).not.toContain('RxDiscordLogo');
      expect(sidePanelSource).not.toContain('discord.gg');
      expect(sidePanelSource).not.toContain('welcome_quickStart');
      expect(sidePanelSource).toContain('favoritePrompts.length > 0');
    });
  });
});

describe('Feature: design/003 task main blocks', () => {
  it('TaskStatusCard source includes goal/rounds/approval testids', () => {
    expect(taskStatusCardSource).toContain('task-goal-block');
    expect(taskStatusCardSource).toContain('task-round-timeline');
    expect(taskStatusCardSource).toContain('task-approval-card');
    expect(taskStatusCardSource).toContain('completion-receipt');
    expect(taskStatusCardSource).toContain('completion-receipt-meta');
    expect(taskStatusCardSource).toContain('completion-receipt-details');
    expect(taskStatusCardSource).toContain('completion-evidence-list');
    expect(taskStatusCardSource).not.toContain('批准一次'); // uses i18n key
    expect(taskStatusCardSource).toContain('chat_task_approve');
  });

  it('humanActionLabel maps machine actions to Chinese product copy', async () => {
    const { humanActionLabel } = await import('../../components/TaskStatusCard');
    expect(humanActionLabel('input_text')).toBe('填写表单');
    expect(humanActionLabel('control_media')).toBe('媒体控制');
  });

  it('header brand uses scion logo asset', () => {
    expect(sidePanelSource).toContain('logo-header.png');
    expect(sidePanelSource).toContain('data-testid="header-logo"');
    expect(sidePanelSource).toContain('logo-mark.png');
  });

  it('Options overview implements design/003 cards', () => {
    const overview = readFileSync(resolve(optionsRoot, 'components/OverviewSettings.tsx'), 'utf8');
    expect(optionsTsx).toContain('OverviewSettings');
    expect(optionsTsx).toContain('logo-header.png');
    expect(overview).toContain('overview-pipeline');
    expect(overview).toContain('overview-model');
    expect(overview).toContain('overview-approval');
    expect(overview).toContain('overview-skill');
    expect(overview).toContain('overview-receipt');
    expect(overview).toContain('overview-privacy');
    expect(overview).toContain('agentCoreBackend');
    // Skill is task recipe, not tool chip wall
    expect(overview).toMatch(/可验证任务配方/);
  });

  it('failed task shows failureCategory surface (not empty chat-only hint)', () => {
    expect(taskStatusCardSource).toContain('failureCategory');
    expect(taskStatusCardSource).toContain('failureCategoryHint');
    expect(taskStatusCardSource).toContain('task-failure-reason');
    expect(taskStatusCardSource).toContain('chat_task_fail_observe');
    expect(taskStatusCardSource).not.toMatch(/可看上方聊天里的失败说明/);
  });
});

describe('Feature: ticket 01 Tabbit-class task mode surface (S1)', () => {
  it('ChatInput is labeled task/agent mode with task placeholder keys', () => {
    const chatInput = readFileSync(resolve(here, '../../components/ChatInput.tsx'), 'utf8');
    expect(chatInput).toContain('data-testid="task-mode-badge"');
    expect(chatInput).toContain('chat_task_mode_badge');
    expect(chatInput).toContain('chat_task_input_placeholder');
    expect(chatInput).not.toMatch(/Planner|Navigator|step_failed/);
  });

  it('TaskStatusCard has collapsible execution steps and outcome rating after receipt', () => {
    expect(taskStatusCardSource).toContain('data-testid="task-steps-toggle"');
    expect(taskStatusCardSource).toContain('data-testid="task-execution-steps"');
    expect(taskStatusCardSource).toContain('shouldShowVerifiedDone');
    expect(taskStatusCardSource).toContain('data-testid="task-outcome-rating"');
    expect(taskStatusCardSource).toContain('data-testid={`task-rate-${rating}`}');
    expect(taskStatusCardSource).toContain('t(`chat_task_rate_${rating}`)');
    expect(taskStatusCardSource).toContain('chijie-rating-control');
    expect(taskStatusCardSource).toContain('role="radiogroup"');
    expect(taskStatusCardSource).toContain('type="radio"');
  });

  it('completion block is gated on receipt helper (no bare model done)', () => {
    expect(taskStatusCardSource).toContain('shouldShowVerifiedDone');
    expect(taskStatusCardSource).toMatch(/shouldShowVerifiedDone\(snapshot,\s*round\?\.receipt\)/);
  });

  it('puts consequential approval before execution history in reading order', () => {
    expect(taskStatusCardSource.indexOf('task-approval-card')).toBeLessThan(
      taskStatusCardSource.indexOf('task-round-timeline'),
    );
  });

  it('locks approval controls while a decision is being acknowledged', () => {
    expect(taskStatusCardSource).toContain('approvalDecision');
    expect(taskStatusCardSource).toContain('disabled={approvalDecision !== null}');
    expect(taskStatusCardSource).toContain('aria-busy={approvalDecision !== null}');
  });

  it('keeps Skill form input until the save command is acknowledged', () => {
    expect(taskStatusCardSource).toContain('skillSavePendingId');
    expect(taskStatusCardSource).toContain('round?.commandAcks[skillSavePendingId]');
    expect(taskStatusCardSource).not.toMatch(/type: 'save_skill',[\s\S]{0,700}setSkillTemplate\(''\);/);
  });

  it('keeps the composer compact at rest', () => {
    const chatInput = readFileSync(resolve(here, '../../components/ChatInput.tsx'), 'utf8');
    expect(chatInput).toContain('Math.min(textarea.scrollHeight, 72)');
    expect(chatInput).toContain('rows={2}');
  });
});
