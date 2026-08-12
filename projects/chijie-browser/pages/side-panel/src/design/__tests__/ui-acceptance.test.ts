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
import type { EvidenceSpace, TaskSnapshot } from '@extension/storage';
import { canRetryResearchFailure, instructionToSkillTemplate } from '../../components/TaskStatusCard';
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
const taskProgressOverviewSource = readFileSync(resolve(here, '../../components/TaskProgressOverview.tsx'), 'utf8');
const thinkingReasoningSource = readFileSync(resolve(here, '../../components/ThinkingReasoning.tsx'), 'utf8');
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
      expect(tokensCss).toMatch(/--chijie-background:\s*#fbfaf7/i);
      expect(tokensCss).toMatch(/--chijie-paper:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-accent:\s*#166f4e/i);
      expect(tokensCss).toMatch(/--chijie-surface:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-foreground:\s*#1f2d2a/i);
      expect(tokensCss).toMatch(/--chijie-warning:\s*#e6a11a/i);
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
        instructionToSkillTemplate('Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.'),
      ).toBe('Fill Name with {{name}} and submit; success is Saved successfully.');
    });
  });

  describe('Scenario: Task recovery copy stays user-facing', () => {
    it('task actions container is a column flex class', () => {
      const block = componentsCss.slice(componentsCss.indexOf('.chijie-action-stack'));
      expect(block).toContain('.chijie-action-stack');
      expect(block.slice(0, 200)).toContain('flex-direction: column');
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

  describe('Scenario: First-run setup uses 持节 calm form (not sky chrome)', () => {
    it('binds first-run setup without multi-page onboarding or sky utilities', () => {
      expect(sidePanelSource).toContain('FirstRunSetup');
      expect(sidePanelSource).toContain('hasConfiguredModels === false');
      expect(componentsCss).toContain('.chijie-first-setup');
      expect(componentsCss).toContain(primaryButtonClassName);
      expect(componentsCss).toContain(welcomeClassName);
      // first-run region must not use stock sky chrome
      const welcomeSlice = sidePanelSource.slice(
        sidePanelSource.indexOf('hasConfiguredModels === false'),
        sidePanelSource.indexOf('hasConfiguredModels === true'),
      );
      expect(welcomeSlice.length).toBeGreaterThan(50);
      expect(welcomeSlice).not.toMatch(/text-sky-/);
      expect(welcomeSlice).not.toMatch(/bg-sky-/);
      expect(welcomeSlice).not.toMatch(/border-sky-/);
      expect(welcomeSlice).not.toMatch(/openOptionsPage/);
      void welcomeCardClassName;
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

    it('keeps the active composer available and demotes stop beside continuous controls', () => {
      expect(sidePanelSource).toContain('const busy = false');
      expect(sidePanelSource).toContain('showStopButton={false}');
      expect(sidePanelSource).toContain('data-task-active={liveTaskConsole || showStopButton');
      expect(sidePanelSource).toContain('data-testid="composer-continuous-controls"');
      expect(sidePanelSource).toContain('data-testid="composer-stop"');
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
  it('progress console and TaskStatusCard include mission, public work stream, and completion testids', () => {
    expect(taskProgressOverviewSource).toContain('task-goal-block');
    expect(taskProgressOverviewSource).toContain('MissionPlanList');
    expect(readFileSync(resolve(here, '../../components/MissionPlanList.tsx'), 'utf8')).toContain('mission-plan');
    expect(taskStatusCardSource).toContain('ThinkingReasoning');
    expect(thinkingReasoningSource).toContain('task-thinking-reasoning');
    expect(taskStatusCardSource).toContain('completion-receipt');
    expect(taskStatusCardSource).toContain('completion-receipt-meta');
    expect(taskStatusCardSource).toContain('completion-receipt-details');
    expect(taskStatusCardSource).toContain('completion-evidence-list');
    expect(taskStatusCardSource).not.toContain('批准一次');
  });

  it('keeps fixed health + Now lines and collapses audit by default (design/008 S1–S2)', () => {
    expect(taskProgressOverviewSource).toContain('task-progress-health');
    expect(taskProgressOverviewSource).toContain('task-progress-current-activity');
    expect(taskProgressOverviewSource).toContain('task-now-summary');
    expect(taskProgressOverviewSource).toContain('task-now-purpose');
    expect(componentsCss).toContain('.chijie-progress-health');
    expect(componentsCss).toContain('.chijie-progress-now');
    expect(thinkingReasoningSource).not.toContain('思考中');
    expect(thinkingReasoningSource).not.toContain('is-shimmer');
  });

  it('mission plan is collapsible and driven by truthful runtime status rather than demo timers', () => {
    const missionPlanListSource = readFileSync(resolve(here, '../../components/MissionPlanList.tsx'), 'utf8');
    expect(missionPlanListSource).toContain('aria-expanded={!collapsed}');
    expect(missionPlanListSource).toContain('missionPlanItemStatus');
    expect(missionPlanListSource).toContain("taskStatus === 'paused'");
    expect(missionPlanListSource).toContain("taskStatus === 'needs_user'");
    expect(missionPlanListSource).toContain("taskStatus === 'failed'");
    expect(missionPlanListSource).not.toContain('START_DELAY');
    expect(missionPlanListSource).not.toContain('STEP_MS');
    expect(missionPlanListSource).not.toMatch(/setTimeout\(\(\)\s*=>\s*setCurrent/);
    expect(componentsCss).toContain('.chijie-plan-collapsible.is-collapsed');
    expect(componentsCss).toContain("li[data-status='waiting_user']");
    expect(componentsCss).toContain("li[data-status='failed']");
  });

  it('humanActionLabel maps machine actions to Chinese product copy', async () => {
    const { humanActionLabel } = await import('../../components/TaskStatusCard');
    expect(humanActionLabel('input_text')).toBe('填写表单');
    expect(humanActionLabel('control_media')).toBe('播放或暂停媒体');
    expect(humanActionLabel('close_tab')).toBe('关闭标签');
    expect(humanActionLabel('switch_tab')).toBe('切换标签');
  });

  it('header brand uses scion logo asset', () => {
    expect(sidePanelSource).toContain('logo-header.png');
    expect(sidePanelSource).toContain('data-testid="header-logo"');
    const firstRun = readFileSync(resolve(here, '../../components/FirstRunSetup.tsx'), 'utf8');
    expect(firstRun).toContain('logo-mark.png');
  });

  it('Options overview implements design/003 cards', () => {
    const overview = readFileSync(resolve(optionsRoot, 'components/OverviewSettings.tsx'), 'utf8');
    expect(optionsTsx).toContain('OverviewSettings');
    expect(optionsTsx).toContain('logo-header.png');
    expect(overview).toContain('overview-pipeline');
    expect(overview).toContain('overview-model');
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

  it('waiting_user non-proof surface exposes wait-continue / wait-retry affordance', () => {
    expect(taskStatusCardSource).toContain('waitUserActionTestId');
    expect(taskStatusCardSource).toContain('wait-continue');
    expect(taskStatusCardSource).toContain('wait-retry');
    expect(taskStatusCardSource).toContain("type: 'resume'");
    expect(taskStatusCardSource).toContain('criterion-confirm');
    expect(taskStatusCardSource).not.toContain('proof-deadend-escape');
    expect(taskStatusCardSource).not.toContain('task-cancel-deadend');
  });

  it('interrupted task uses one compact recovery status with stop demoted to the more menu', () => {
    expect(taskProgressOverviewSource).toContain('data-testid="task-interrupted-status"');
    expect(taskProgressOverviewSource).toContain('任务已中断，进度已经保存');
    expect(taskStatusCardSource).toContain('data-testid="task-resume"');
    expect(taskStatusCardSource).toContain('data-testid="task-stop-menu"');
    expect(taskStatusCardSource).toContain("snapshot.status !== 'interrupted'");
    expect(componentsCss).toContain('.chijie-interrupted-status');
    expect(componentsCss).toContain('.chijie-interrupted-actions');
    expect(componentsCss).toContain('.chijie-interrupted-menu');
  });

  it('failed quota research exposes an explicit retry that preserves the task shell', () => {
    const snapshot = {
      id: 'task-research',
      status: 'failed',
      currentRoundId: 'round-1',
      rounds: [{ id: 'round-1', failureCategory: 'research_quota_unmet' }],
    } as TaskSnapshot;
    expect(canRetryResearchFailure(snapshot)).toBe(true);
    expect(canRetryResearchFailure({ ...snapshot, status: 'completed' })).toBe(false);
    expect(
      canRetryResearchFailure(
        {
          ...snapshot,
          rounds: [{ ...snapshot.rounds[0], failureCategory: 'executor_start_failed' }],
        },
        { taskId: snapshot.id, records: [{}], workCycles: 1 } as EvidenceSpace,
      ),
    ).toBe(true);
    expect(taskStatusCardSource).toContain('data-testid="research-retry"');
    expect(taskStatusCardSource).toContain("type: 'retry_research'");
    expect(taskStatusCardSource).toContain('chat_task_retry_research');
    expect(sidePanelSource).toMatch(/command\.type === 'retry_research'[\s\S]{0,500}resolveActiveContentTab/);
    expect(sidePanelSource).toContain('resolveActiveContentTab({ allowLastFocused: false })');
    expect(sidePanelSource).toContain('postCommand(bound ? { ...command, tabId: bound.tabId } : command)');
    expect(sidePanelSource.indexOf('{ currentWindow: true }')).toBeLessThan(
      sidePanelSource.indexOf('{ active: true, lastFocusedWindow: true }'),
    );
  });

  it('persists a verified text deliverable into chat with receipt-level deduplication', () => {
    expect(sidePanelSource).toContain('completionChatDelivery');
    expect(sidePanelSource).toContain('hasCompletionChatDelivery');
    expect(sidePanelSource).toContain('deliveredCompletionReceiptsRef');
  });
});

describe('Feature: ticket 01 Tabbit-class task mode surface (S1)', () => {
  it('ChatInput is labeled task/agent mode with task placeholder keys', () => {
    const chatInput = readFileSync(resolve(here, '../../components/ChatInput.tsx'), 'utf8');
    expect(chatInput).toContain('data-testid="task-mode-badge"');
    expect(chatInput).toContain('chat_task_mode_badge');
    expect(chatInput).toContain('chat_task_input_placeholder');
    expect(chatInput).toContain('chijie-prompt-frame');
    expect(chatInput).toContain('chijie-prompt-send');
    expect(chatInput).toContain('FiArrowUp');
    expect(chatInput).toContain('onSendMessage(messageContent, displayContent)');
    expect(chatInput).toContain('onClick={onMicClick}');
    expect(chatInput).toContain('accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"');
    expect(componentsCss).toContain('.chijie-prompt-frame');
    expect(componentsCss).toContain('.chijie-prompt-menu');
    expect(componentsCss).toContain('.chijie-prompt-chip');
    expect(componentsCss).toContain('.chijie-composer .chijie-prompt-field:focus-visible');
    expect(componentsCss).not.toContain('.chijie-prompt-frame:focus-within');
    expect(chatInput).not.toMatch(/Planner|Navigator|step_failed/);
  });

  it('TaskStatusCard has a collapsible public work stream and outcome rating after receipt', () => {
    expect(thinkingReasoningSource).toContain('aria-expanded={open}');
    expect(thinkingReasoningSource).toContain('展开或收起任务处理过程');
    expect(taskStatusCardSource).toContain('shouldShowVerifiedDone');
    expect(taskStatusCardSource).toContain('data-testid="task-outcome-rating"');
    expect(taskStatusCardSource).toContain('data-testid={`task-rate-${rating}`}');
    expect(taskStatusCardSource).toContain('t(`chat_task_rate_${rating}`)');
    expect(taskStatusCardSource).toContain('chijie-rating-control');
    expect(taskStatusCardSource).toContain('role="radiogroup"');
    expect(taskStatusCardSource).toContain('type="radio"');
  });

  it('TaskStatusCard activity panel uses elapsed, privacy-safe real action summaries', () => {
    expect(taskStatusCardSource).toContain('data-testid="task-activity-panel"');
    expect(taskStatusCardSource).toContain('publicActivityItems');
    expect(taskStatusCardSource).toContain('formatActivityDuration');
    expect(taskStatusCardSource).toContain('attemptDisplayTitle');
    expect(taskStatusCardSource).toContain('displaySummary');
    expect(thinkingReasoningSource).toContain('never model chain-of-thought');
    expect(thinkingReasoningSource).not.toContain('SENTENCES');
    expect(thinkingReasoningSource).not.toContain('DELAYS');
    expect(thinkingReasoningSource).not.toMatch(/setTimeout/);
    expect(taskStatusCardSource).not.toMatch(/Planner|Navigator|step_failed/);
  });

  it('completion block always shows result sentence and copyable deliverable slot', () => {
    expect(taskStatusCardSource).toContain('requiredCompletionResult');
    expect(taskStatusCardSource).toContain('data-testid="completion-result"');
    expect(taskStatusCardSource).toContain('completion-deliverable');
    expect(taskStatusCardSource).toContain('chijie-completion-deliverable');
    expect(taskStatusCardSource).toContain('completion-deliverable-copy');
    expect(componentsCss).toContain('.chijie-completion-deliverable');
  });

  it('completion block is gated on receipt helper (no bare model done)', () => {
    expect(taskStatusCardSource).toContain('shouldShowVerifiedDone');
    expect(taskStatusCardSource).toMatch(/shouldShowVerifiedDone\(snapshot,\s*round\?\.receipt\)/);
  });

  it('progress-console hierarchy: status → durable progress → collapsed audit; composer remains usable', () => {
    const returnIdx = taskStatusCardSource.lastIndexOf('return (');
    const tree = taskStatusCardSource.slice(returnIdx);
    // Stable mission and durable progress stay above raw browser operations.
    expect(tree.indexOf('TaskProgressOverview')).toBeLessThan(tree.indexOf('task-activity-panel'));
    expect(taskStatusCardSource).toContain('data-primary-organism={primaryOrganism}');
    expect(taskStatusCardSource).toContain('taskPrimaryOrganism');
    expect(taskStatusCardSource).toContain("snapshot.status === 'running' || showSteps");
    // Completion honesty remains above the secondary audit history.
    expect(tree.indexOf("primaryOrganism === 'completion' && completionBlock")).toBeLessThan(
      tree.indexOf("primaryOrganism !== 'activity' && showActivityPanel"),
    );
    // Running action summaries stay secondary; health + Now are the fixed live-status lines.
    expect(tree).toContain("primaryOrganism === 'activity' && showActivityPanel");
    expect(tree).toContain('data-secondary="true"');
    expect(tree).toContain('{thinkingReasoning}');
    expect(taskProgressOverviewSource).toContain('task-progress-current-activity');
    expect(taskProgressOverviewSource).toContain('task-progress-health');
    // The progress workspace gets meaningful height while chat and the fixed composer remain usable.
    expect(componentsCss).toMatch(/\.chijie-chat-log[\s\S]{0,120}min-height:\s*8\.5rem/);
    expect(componentsCss).toMatch(/\.chijie-paper-card[\s\S]{0,200}max-height:\s*min\(58vh,\s*560px\)/);
    expect(componentsCss).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(sidePanelSource).toContain('chijie-workspace');
    expect(sidePanelSource).toContain('chijie-chat-log');
    expect(sidePanelSource).toContain('chijie-composer');
    // S4: live-task chat folds by default; S6: pause/resume beside composer, stop demoted.
    expect(sidePanelSource).toContain('data-testid="chat-log-fold"');
    expect(sidePanelSource).toContain("data-collapsed={chatCollapsed ? 'true' : 'false'}");
    expect(sidePanelSource).toContain('data-testid="composer-continuous-controls"');
    expect(sidePanelSource).toContain('data-testid="composer-pause"');
    expect(sidePanelSource).toContain('data-testid="composer-resume"');
    expect(sidePanelSource).toContain('data-testid="composer-stop"');
    expect(sidePanelSource).toContain("type: 'pause'");
    expect(sidePanelSource).toContain("type: 'resume'");
    expect(componentsCss).toContain('.chijie-chat-fold');
    expect(componentsCss).toContain('.chijie-composer-controls');
    expect(sidePanelSource).toMatch(/onAdjustDirection=\{\(\) => \{[\s\S]{0,600}setInputEnabled\(true\)/);
    expect(sidePanelSource).toMatch(/onAdjustDirection=\{\(\) => \{[\s\S]{0,300}setIsHistoricalSession\(false\)/);
    expect(sidePanelSource).toContain("setInputTextRef.current?.(t('chat_task_adjust_prompt'))");
    expect(sidePanelSource).toContain("changeType: isDirectionChange ? 'direction_change' : 'follow_up'");
    expect(taskProgressOverviewSource).toContain('data-testid="task-direction-change"');
    expect(t('chat_task_adjust_prompt')).toBe('我想调整：');
    expect(t('chat_task_bind_kicker')).toBe('当前页面');
  });

  it('generic mission plan hides phase-ratio pie without durable gates (design/008 S3)', () => {
    const missionPlanListSource = readFileSync(resolve(here, '../../components/MissionPlanList.tsx'), 'utf8');
    expect(missionPlanListSource).toContain('data-durable-progress');
    expect(missionPlanListSource).toContain('showPie={hasDurableGates}');
    expect(missionPlanListSource).toContain('里程碑');
    expect(missionPlanListSource).toContain('no phase-count pie');
  });

  it('side-panel tokens expose a compact type + space ladder (design/008 S5)', () => {
    const tokensCss = readFileSync(resolve(here, '../chijie-tokens.css'), 'utf8');
    expect(tokensCss).toContain('--chijie-text-xs');
    expect(tokensCss).toContain('--chijie-text-sm');
    expect(tokensCss).toContain('--chijie-text-md');
    expect(tokensCss).toContain('--chijie-text-lg');
    expect(tokensCss).toContain('--chijie-space-1');
    expect(tokensCss).toContain('--chijie-space-section');
    expect(tokensCss).toContain('--chijie-weight-semibold');
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
