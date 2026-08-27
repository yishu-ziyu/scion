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
import { instructionToSkillTemplate } from '../../components/TaskStatusCard';
import { commandRejectionMessage, confirmsNewChatCancellation, shouldAcceptTaskSignal } from '../../SidePanel';

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
const processDisclosureSource = readFileSync(resolve(here, '../../components/ProcessDisclosure.tsx'), 'utf8');
const taskProgressOverviewSource = readFileSync(resolve(here, '../../components/TaskProgressOverview.tsx'), 'utf8');
const workStreamSource = readFileSync(resolve(here, '../../components/WorkStream.tsx'), 'utf8');
const answerProseSource = readFileSync(resolve(here, '../../components/AnswerProse.tsx'), 'utf8');
const sidePanelSource = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
const activeTabRuntimeSource = readFileSync(resolve(here, '../../presentation/active-tab-runtime.ts'), 'utf8');
const sidePanelHeaderSource = readFileSync(resolve(here, '../../components/SidePanelHeader.tsx'), 'utf8');
const pictureInPictureButtonSource = readFileSync(resolve(here, '../../components/PictureInPictureButton.tsx'), 'utf8');
const documentPipSource = readFileSync(resolve(here, '../../presentation/document-pip.ts'), 'utf8');
const chatHistorySource = readFileSync(resolve(here, '../../components/ChatHistoryList.tsx'), 'utf8');
const bookmarkListSource = readFileSync(resolve(here, '../../components/BookmarkList.tsx'), 'utf8');
const messageListSource = readFileSync(resolve(here, '../../components/MessageList.tsx'), 'utf8');
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
const memoryRoot = resolve(here, '../../../../memory/src');
const memoryPageTsx = readFileSync(resolve(memoryRoot, 'MemoryPage.tsx'), 'utf8');
const memoryIndexCss = readFileSync(resolve(memoryRoot, 'index.css'), 'utf8');
const memoryTokensCss = readFileSync(resolve(memoryRoot, 'design/chijie-tokens.css'), 'utf8');
const memoryCss = readFileSync(resolve(memoryRoot, 'design/chijie-memory.css'), 'utf8');
const memoryZh = JSON.parse(
  readFileSync(resolve(here, '../../../../../packages/i18n/locales/zh_CN/messages.json'), 'utf8'),
) as Record<string, { message?: string }>;

function tokenHex(name: string): string {
  const match = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match?.[1]) throw new Error(`missing hex token ${name}`);
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
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Feature: Side panel uses 持节 design system', () => {
  describe('Scenario: Design tokens are the only color source for the shell', () => {
    it('defines required CSS custom properties from DESIGN.md', () => {
      for (const name of YISHU_TOKEN_NAMES) {
        expect(tokensCss, `missing token ${name}`).toContain(`${name}:`);
      }
      expect(tokensCss).toMatch(/--chijie-background:\s*#f6f6f5/i);
      expect(tokensCss).toMatch(/--chijie-paper:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-accent:\s*#1c1b19/i);
      expect(tokensCss).toMatch(/--chijie-surface:\s*#ffffff/i);
      expect(tokensCss).toMatch(/--chijie-foreground:\s*#1c1b19/i);
      expect(tokensCss).toMatch(/--chijie-warning:\s*#855600/i);
    });

    it('keeps small status copy at WCAG AA contrast on its subtle surfaces', () => {
      expect(contrastRatio(tokenHex('--chijie-warning'), tokenHex('--chijie-warning-subtle'))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(tokenHex('--chijie-danger'), tokenHex('--chijie-danger-subtle'))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(tokenHex('--chijie-paper-muted'), tokenHex('--chijie-paper'))).toBeGreaterThanOrEqual(4.5);
    });

    it('exposes paper-card and pill-button class contracts', () => {
      expect(taskCardClassName).toBe('chijie-paper-card');
      expect(primaryButtonClassName).toBe('chijie-btn-primary');
      expect(componentsCss).toContain('.chijie-paper-card');
      expect(componentsCss).toContain('.chijie-btn-primary');
      expect(componentsCss).toMatch(/border-radius:\s*var\(--chijie-radius-pill\)/);
      expect(tokensCss).toMatch(/--chijie-radius-pill:\s*60px/);
      expect(tokensCss).toMatch(/--chijie-radius-xl:\s*20px/);
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
      expect(commandRejectionMessage('not_executable', '你好，需要我帮你在页面上做什么？')).toBe(
        '你好，需要我帮你在页面上做什么？',
      );
      expect(commandRejectionMessage('invalid_input', '当前标签不是网页，读不了「这个页面」。')).toContain('这个页面');
      expect(sidePanelSource).not.toContain('Command rejected:');
    });

    it('does not decide user turns in the side panel; start/follow_up is classified in TaskManager.dispatch', () => {
      expect(sidePanelSource).not.toContain("type: 'user_turn_decision'");
      expect(sidePanelSource).toContain('forceExecute');
      expect(sidePanelSource).not.toContain('composerIntent');
    });
  });

  describe('Scenario: Components bind to yishu classes (not stock sky chrome)', () => {
    it('TaskStatusCard uses paper card + primary pill + action stack contracts', () => {
      expect(taskStatusCardSource).toContain("from '../design/contracts'");
      expect(taskStatusCardSource).toContain('taskCardClassName');
      expect(taskStatusCardSource).toContain('primaryButtonClassName');
      expect(taskStatusCardSource).toContain('AnswerProse');
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
      expect(indexCss).toMatch(/chijie-motion\.css/);
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
      expect(optionsTokensCss).toMatch(/--chijie-background:\s*#f6f6f5/i);
      expect(optionsTokensCss).toMatch(/--chijie-accent:\s*#1c1b19/i);
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

  describe('Scenario: Memory page is an independent fact editor (not a notes dump)', () => {
    it('uses 持节 tokens, a narrow column, and empty-state copy that names the next action', () => {
      expect(memoryIndexCss).toMatch(/chijie-tokens\.css/);
      expect(memoryTokensCss).toMatch(/--chijie-background:\s*#000000/i);
      expect(memoryCss).toContain('.chijie-memory-column');
      expect(memoryCss).toContain('width: min(36rem');
      expect(memoryCss).not.toMatch(/box-shadow/);
      expect(memoryPageTsx).toContain('memory_empty');
      expect(memoryZh.memory_empty?.message).toContain('整理成条目');
      expect(memoryPageTsx).toContain('memory_structure');
      expect(memoryPageTsx).toContain('structure_user_memory');
      expect(sourceHasBannedSkyChrome(memoryPageTsx)).toBe(false);
      expect(sidePanelHeaderSource).toContain('memory/index.html');
      expect(sidePanelHeaderSource).toContain('nav_memory_a11y');
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
      expect(sidePanelSource).toContain('const busy = shouldSuppressExecutionForSessionRecovery');
      expect(sidePanelSource).toContain('showStopButton={false}');
      expect(sidePanelSource).toContain('data-task-active={liveTaskConsole || showStopButton');
      expect(sidePanelSource).toContain('data-testid="composer-continuous-controls"');
      expect(sidePanelSource).toContain('data-testid="composer-stop"');
      expect(sidePanelSource).toContain('IdleHome');
      expect(readFileSync(resolve(here, '../../components/IdleHome.tsx'), 'utf8')).toContain(
        'data-testid="empty-composer-spacer"',
      );
      expect(readFileSync(resolve(here, '../../components/IdleHome.tsx'), 'utf8')).toContain('idle-examples');
      expect(sidePanelSource).not.toMatch(/Chat\s*\/\s*Claw|data-testid="claw-rail"/);
    });

    it('removes upstream promotion surfaces from the product shell', () => {
      expect(sidePanelSource).not.toContain('RxDiscordLogo');
      expect(sidePanelSource).not.toContain('discord.gg');
      expect(sidePanelSource).not.toContain('welcome_quickStart');
      expect(sidePanelSource).toContain('visibleFavoritePrompts.length > 0');
    });
  });
});

describe('Feature: design/003 task main blocks', () => {
  it('progress console and TaskStatusCard include mission, public work stream, and completion testids', () => {
    expect(taskProgressOverviewSource).toContain('task-goal-block');
    expect(taskProgressOverviewSource).not.toContain('>目标<');
    expect(taskProgressOverviewSource).not.toContain('MissionPlanList');
    expect(taskStatusCardSource).not.toContain('NowTrace');
    expect(taskStatusCardSource).not.toContain('ThinkingReasoning');
    expect(taskStatusCardSource).toContain('WorkStream');
    expect(workStreamSource).toContain('task-work-stream');
    expect(workStreamSource).toContain('task-search-board');
    expect(taskStatusCardSource).toContain('completion-receipt');
    expect(taskStatusCardSource).toContain('AnswerProse');
    expect(taskStatusCardSource).not.toContain('completion-receipt-meta');
    expect(taskStatusCardSource).not.toContain('completion-receipt-details');
    expect(taskStatusCardSource).not.toContain('completion-evidence-list');
    expect(taskStatusCardSource).not.toContain('批准一次');
  });

  it('keeps fixed health + Now lines and collapses audit by default (design/008 S1–S2)', () => {
    expect(taskProgressOverviewSource).toContain('task-progress-health');
    expect(taskProgressOverviewSource).toContain('task-progress-current-activity');
    expect(processDisclosureSource).toContain('task-now-summary');
    expect(processDisclosureSource).toContain('liveProcessFold');
    expect(processDisclosureSource).toContain('data-live="true"');
    expect(taskProgressOverviewSource).not.toContain('task-now-purpose');
    expect(taskStatusCardSource).not.toContain('task-now-purpose');
    expect(processDisclosureSource).not.toContain('task-now-purpose');
    expect(componentsCss).toContain('.chijie-progress-health');
    expect(componentsCss).toContain('.chijie-progress-now');
    expect(workStreamSource).not.toContain('思考中');
    expect(componentsCss).toContain(".chijie-thinking[data-running='true'] .chijie-thinking-label");
    expect(componentsCss).toContain(".chijie-process-disclosure[data-live='true'] [data-testid='task-now-summary']");
    expect(componentsCss).toContain('chijie-label-shine');
  });

  it('live path does not render the unused plan list or now-trace', () => {
    expect(taskProgressOverviewSource).not.toContain('MissionPlanList');
    expect(taskStatusCardSource).not.toContain('deriveNowTrace');
    expect(taskStatusCardSource).not.toContain('data-testid="skill-save"');
    expect(workStreamSource).toContain('task-work-stream');
  });

  it('humanActionLabel maps machine actions to Chinese product copy', async () => {
    const { humanActionLabel } = await import('../../components/TaskStatusCard');
    expect(humanActionLabel('input_text')).toBe('填写表单');
    expect(humanActionLabel('control_media')).toBe('播放或暂停媒体');
    expect(humanActionLabel('close_tab')).toBe('关闭标签');
    expect(humanActionLabel('switch_tab')).toBe('切换标签');
  });

  it('header brand uses scion logo asset', () => {
    expect(sidePanelHeaderSource).toContain('logo-header.png');
    expect(sidePanelHeaderSource).toContain('data-testid="header-logo"');
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
    expect(overview).not.toContain('agentCoreBackend');
    expect(overview).not.toContain('backend-nano');
    expect(modelSettings).toMatch(/\[AgentNameEnum\.Navigator, AgentNameEnum\.Validator\]/);
    expect(modelSettings).not.toMatch(/\[AgentNameEnum\.Planner, AgentNameEnum\.Navigator, AgentNameEnum\.Validator\]/);
    // Skill is task recipe, not tool chip wall
    expect(overview).toMatch(/可验证任务配方/);
    expect(overview).not.toMatch(/1\. 总览/);
    expect(overview).not.toMatch(/G6|L4|RCPT-/);
  });

  it('failed task shows one human result sentence and 再说一次, not stacked failure chrome', () => {
    expect(taskStatusCardSource).toContain('deriveFailedResult');
    expect(taskStatusCardSource).toContain('is-failed');
    expect(taskStatusCardSource).toContain('task-retry');
    expect(taskStatusCardSource).toContain('chijie-failed-result');
    expect(taskStatusCardSource).not.toMatch(/可看上方聊天里的失败说明/);
    expect(taskStatusCardSource).not.toMatch(/snapshot\.status === 'failed' \? \(\s*ratingBlock/);
    expect(taskStatusCardSource).not.toContain('task-status-label');
    expect(taskProgressOverviewSource).not.toContain("failedAudit ? '做过' : '现在'");
    expect(taskProgressOverviewSource).not.toContain('做过');
    expect(t('chat_task_product_fail_model_loop')).not.toMatch(/模型反复|步数耗尽/);
  });

  it('waiting_user controls follow the TaskManager transition contract', () => {
    expect(taskStatusCardSource).toContain('waitUserAction');
    expect(taskStatusCardSource).toContain('wait-compose-follow-up');
    expect(taskStatusCardSource).not.toContain('data-testid="wait-continue"');
    expect(taskStatusCardSource).not.toContain('data-testid="wait-retry"');
    const recoveryStart = taskStatusCardSource.indexOf('One valid CTA');
    const recoverySlice = taskStatusCardSource.slice(
      recoveryStart,
      taskStatusCardSource.indexOf('showPartialComplete', recoveryStart),
    );
    expect(recoverySlice).not.toContain("type: 'resume'");
    expect(taskStatusCardSource).toContain('criterion-confirm');
    expect(taskStatusCardSource).not.toContain('proof-deadend-escape');
    expect(taskStatusCardSource).not.toContain('task-cancel-deadend');
    expect(sidePanelSource).toContain('onContinueInComposer');
    expect(sidePanelSource).toContain("taskSnapshot!.status === 'waiting_user'");
    expect(sidePanelSource).toContain("taskSnapshot!.status === 'inputs_required'");
    expect(sidePanelSource).toContain('data-testid="composer-stop"');
  });

  it('composer has no 仅聊天 / 执行 rail; one send starts the loop', () => {
    const waitAskSource = readFileSync(resolve(here, '../../presentation/wait-ask.ts'), 'utf8');
    const chatInput = readFileSync(resolve(here, '../../components/ChatInput.tsx'), 'utf8');
    expect(waitAskSource).not.toContain('confirm_execute');
    expect(chatInput).not.toContain('data-testid="composer-intent"');
    expect(chatInput).not.toContain('chat_composer_chat');
    expect(chatInput).not.toContain('chat_composer_execute');
    expect(chatInput).not.toContain('sendOptionsFromComposerIntent');
    expect(sidePanelSource).not.toContain('composerIntent');
    expect(sidePanelSource).not.toContain('shouldDismissConfirmExecuteChat');
    expect(componentsCss).not.toContain('.chijie-composer-intent');
  });

  it('card is user/agent turns, result heavier than process, process fold keeps snapshot', () => {
    expect(taskProgressOverviewSource).toContain('data-turn="user"');
    expect(taskProgressOverviewSource).toContain('data-turn="agent"');
    expect(taskProgressOverviewSource).toContain('task-follow-up');
    expect(taskStatusCardSource).toContain('roundUtterances');
    expect(taskStatusCardSource).toContain('workStreamBody');
    expect(componentsCss).toContain('.chijie-user-bubble.chijie-progress-mission h2');
    expect(componentsCss).toMatch(/\.chijie-answer p,[\s\S]{0,120}--chijie-foreground/);
    expect(componentsCss).toMatch(/\.chijie-act-line,\s*\.chijie-act-chip \{[\s\S]*?--chijie-muted/);
    expect(workStreamSource).toContain('chijie-act-chip');
    const streamLogic = readFileSync(resolve(here, '../../presentation/work-stream.ts'), 'utf8');
    expect(streamLogic).toContain("actionName === 'snapshot'");
    expect(streamLogic).toContain("name === 'switch_tab'");
    expect(streamLogic).not.toContain("'snapshot',");
    expect(streamLogic).not.toContain('thinkingText');
    expect(streamLogic).not.toContain('open: running');
    expect(sidePanelSource).toContain('mergeRestoredSessionMessages');
  });

  it('waiting_user option chips send follow_up text, not Auto Approve or resume', () => {
    expect(taskStatusCardSource).toContain('deriveWaitAsk');
    expect(taskStatusCardSource).toContain('wait-ask-option');
    expect(taskStatusCardSource).toContain('secondaryButtonClassName');
    expect(taskStatusCardSource).toContain('onFollowUp');
    expect(taskStatusCardSource).not.toMatch(/Auto Approve/);
    expect(componentsCss).toContain('.chijie-wait-ask');
    expect(componentsCss).not.toMatch(/box-shadow\s*:/);
    const followUpCall = sidePanelSource.slice(
      sidePanelSource.indexOf('onFollowUp'),
      sidePanelSource.indexOf('onFollowUp') + 180,
    );
    expect(followUpCall).toContain('handleSendMessage');
    expect(followUpCall).not.toContain("type: 'resume'");
  });

  it('interrupted task keeps one compact status while resume and stop live only beside the composer', () => {
    expect(taskProgressOverviewSource).toContain('data-testid="task-interrupted-status"');
    expect(taskProgressOverviewSource).toContain('任务已中断，进度已经保存');
    expect(taskStatusCardSource).not.toContain('data-testid="task-resume"');
    expect(taskStatusCardSource).not.toContain('data-testid="task-stop-menu"');
    expect(sidePanelSource).toContain('data-testid="composer-resume"');
    expect(sidePanelSource).toContain('data-testid="composer-stop"');
    expect(componentsCss).toContain('.chijie-interrupted-status');
    expect(componentsCss).not.toContain('.chijie-interrupted-actions');
    expect(componentsCss).not.toContain('.chijie-interrupted-menu');
  });

  it('new chat waits for a matching cancellation acknowledgement and ignores stale task identity', () => {
    const pending = { taskId: 'task-1', commandId: 'cancel-1' };
    expect(confirmsNewChatCancellation(pending, { taskId: 'task-1', status: 'cancelled' })).toBe(true);
    expect(confirmsNewChatCancellation(pending, { taskId: 'task-1', commandId: 'cancel-1', accepted: true })).toBe(
      true,
    );
    expect(
      confirmsNewChatCancellation(pending, { taskId: 'task-1', commandId: 'another-command', accepted: true }),
    ).toBe(false);
    expect(confirmsNewChatCancellation(pending, { taskId: 'task-2', status: 'cancelled' })).toBe(false);
    expect(confirmsNewChatCancellation(null, { taskId: 'task-1', accepted: true })).toBe(false);
    expect(sidePanelSource).toContain('pendingNewChatCancellationRef');
    expect(sidePanelSource).toContain('dismissedTaskIdsRef');
    expect(sidePanelSource).toContain('sessionGenerationRef');
    expect(sidePanelSource).toContain('let turnSessionId');
    expect(sidePanelSource).toContain('turnGeneration !== sessionGenerationRef.current');
    // TaskManager.cancel awaits persist (which emits task_event) before dispatch returns this exact command ack.
    expect(sidePanelSource).toContain('persists + broadcasts cancel before dispatch resolves');
    expect(sidePanelSource).toContain('newChatCancellationTarget({');
    expect(sidePanelSource).toContain('requestNewChatCancellation(cancellationTaskId, known.revision)');
    expect(sidePanelSource).not.toMatch(/const handleNewChat[\s\S]{0,700}stopConnection\(\)/);
    const finalizeNewChatStart = sidePanelSource.indexOf('const finalizeNewChat =');
    const finalizeNewChatEnd = sidePanelSource.indexOf('finalizeNewChatRef.current =', finalizeNewChatStart);
    const finalizeNewChat = sidePanelSource.slice(finalizeNewChatStart, finalizeNewChatEnd);
    const handleNewChatStart = sidePanelSource.indexOf('const handleNewChat =');
    const handleNewChatEnd = sidePanelSource.indexOf('const loadChatSessions =', handleNewChatStart);
    const handleNewChat = sidePanelSource.slice(handleNewChatStart, handleNewChatEnd);
    expect(sidePanelSource).toContain('const [newChatPending, setNewChatPending] = useState(false);');
    expect(handleNewChat).toContain('setNewChatPending(true);');
    expect(finalizeNewChat).toContain('setNewChatPending(false);');
    expect(sidePanelHeaderSource).toContain('aria-busy={newChatPending}');
    expect(sidePanelHeaderSource).toContain('disabled={newChatPending}');
    expect(sidePanelCss).toContain(".header-icon[aria-busy='true']");
    expect(finalizeNewChat).toContain("setInputTextRef.current?.('');");
    expect(finalizeNewChat).toContain('setComposerResetKey(current => current + 1);');
    expect(finalizeNewChat.indexOf("setInputTextRef.current?.('');")).toBeLessThan(
      finalizeNewChat.indexOf('setMessages([])'),
    );
    expect(finalizeNewChat.indexOf('setComposerResetKey(current => current + 1);')).toBeLessThan(
      finalizeNewChat.indexOf('setMessages([])'),
    );
    expect(sidePanelSource).toContain('key={composerResetKey}');
  });

  it('never lets a late dismissed task reclaim the session after a new task snapshot', () => {
    const dismissed = new Set(['task-a']);
    const current = {
      dismissedTaskIds: dismissed,
      currentTaskId: 'task-b',
      pendingTaskId: null,
      currentSessionId: 'task-b',
    };
    expect(shouldAcceptTaskSignal({ ...current, taskId: 'task-b' })).toBe(true);
    expect(shouldAcceptTaskSignal({ ...current, taskId: 'task-a' })).toBe(false);
    expect(shouldAcceptTaskSignal({ ...current, taskId: 'task-c' })).toBe(false);
    expect(sidePanelSource).not.toContain('dismissedTaskIdsRef.current.clear()');
    expect(sidePanelSource).toContain('dismissedTaskIdsRef.current.delete(sessionId)');
  });

  it('keeps primary controls at least 40px and collapsed content out of the accessibility tree', () => {
    expect(componentsCss).toMatch(/\.chijie-prompt-icon-button[\s\S]{0,180}width:\s*40px[\s\S]{0,50}height:\s*40px/);
    expect(componentsCss).toMatch(/\.chijie-prompt-chip-remove[\s\S]{0,160}width:\s*40px[\s\S]{0,50}height:\s*40px/);
    expect(taskProgressOverviewSource).not.toContain('aria-live="polite"');
  });

  it('keeps history, bookmark, field, and disclosure targets keyboard-visible and at least 40px', () => {
    expect(chatHistorySource).toContain('min-h-12 w-full rounded pr-20');
    expect(chatHistorySource.match(/size-10/g)).toHaveLength(2);
    expect(chatHistorySource).toContain('focus-visible:opacity-100');
    expect(bookmarkListSource).toContain('min-h-10 w-full pr-20');
    expect(bookmarkListSource.match(/size-10/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(bookmarkListSource).toContain('focus-visible:opacity-100');
    expect(messageListSource).toContain('inline-flex min-h-10');
    expect(componentsCss).toMatch(/\.chijie-field[\s\S]{0,100}min-height:\s*40px/);
    expect(sidePanelCss).toMatch(/\.header-icon[\s\S]{0,100}flex:\s*none/);
    expect(componentsCss).toMatch(/\.chijie-prompt-chip-remove[\s\S]{0,100}flex:\s*none/);
    expect(componentsCss).toMatch(
      /\.chijie-progress-direction-change[\s\S]{0,300}color:\s*var\(--chijie-paper-muted\)/,
    );
    expect(chatHistorySource).not.toMatch(/text-sky-/);
  });

  it('binds the next task to the current window content tab before last-focused', () => {
    expect(sidePanelSource).toContain('resolveActiveContentTab({ allowLastFocused: false })');
    expect(activeTabRuntimeSource).toContain('bindTabForTask');
    expect(activeTabRuntimeSource.indexOf('{ currentWindow: true }')).toBeLessThan(
      activeTabRuntimeSource.indexOf('{ lastFocusedWindow: true }'),
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
    expect(chatInput).not.toContain('sendOptionsFromComposerIntent');
    expect(chatInput).toContain('onClick={onMicClick}');
    expect(chatInput).toContain('accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"');
    expect(chatInput).toContain('data-testid="composer-mention-menu"');
    expect(chatInput).toContain('data-testid="composer-mention-button"');
    expect(chatInput).toContain('expandCurrentPageMention');
    expect(componentsCss).toContain('.chijie-prompt-frame');
    expect(componentsCss).toContain('.chijie-prompt-menu');
    expect(componentsCss).toContain('.chijie-mention-menu');
    expect(componentsCss).toContain('.chijie-prompt-chip');
    expect(componentsCss).toContain('.chijie-composer .chijie-prompt-field:focus-visible');
    expect(componentsCss).not.toContain('.chijie-prompt-frame:focus-within');
    expect(chatInput).not.toMatch(/Planner|Navigator|step_failed/);
  });

  it('TaskStatusCard has a live tool log while running and no rating form after delivery', () => {
    expect(processDisclosureSource).toContain('data-testid="live-tool-log"');
    expect(processDisclosureSource).toContain('data-testid="live-stop-generating"');
    expect(processDisclosureSource).toContain("t('chat_task_takeover')");
    expect(workStreamSource).not.toContain('data-testid="live-stop-generating"');
    expect(taskStatusCardSource).toContain('shouldShowVerifiedDone');
    expect(taskStatusCardSource).not.toContain('data-testid="task-outcome-rating"');
    expect(taskStatusCardSource).not.toContain('data-testid={`task-rate-${rating}`}');
    expect(taskStatusCardSource).not.toContain('chijie-rating-control');
  });

  it('TaskStatusCard activity panel uses elapsed, privacy-safe real action summaries', () => {
    expect(processDisclosureSource).toContain('data-testid="task-activity-panel"');
    expect(taskStatusCardSource).toContain('deriveWorkStream');
    expect(taskStatusCardSource).toContain('displaySummary');
    expect(workStreamSource).toContain('task-search-board');
    expect(workStreamSource).toContain('task-act-line');
    expect(workStreamSource).not.toContain('SENTENCES');
    expect(workStreamSource).not.toContain('DELAYS');
    expect(taskStatusCardSource).not.toMatch(/Planner|Navigator|step_failed/);
  });

  it('completion block always shows result sentence and copyable deliverable slot', () => {
    expect(taskStatusCardSource).toContain('requiredCompletionResult');
    expect(taskStatusCardSource).toContain('AnswerProse');
    expect(answerProseSource).toContain('data-testid={testId}');
    expect(taskStatusCardSource).toContain('completion-deliverable');
    expect(taskStatusCardSource).toContain('chijie-completion-deliverable');
    expect(taskStatusCardSource).toContain('completion-deliverable-copy');
    expect(taskStatusCardSource).toContain('writeText(resultSentence)');
    expect(taskStatusCardSource).toContain("t('chat_task_copy_result')");
    expect(taskStatusCardSource).toContain("t('chat_task_copy_done')");
    expect(processDisclosureSource).toContain("t('chat_task_process_disclosure')");
    expect(taskStatusCardSource).not.toContain('>查看过程<');
    expect(taskStatusCardSource).toContain('FiCopy');
    expect(componentsCss).toContain('.chijie-answer');
    expect(componentsCss).toContain('.chijie-answer-section');
    expect(componentsCss).toContain('chijie-answer-in');
    expect(componentsCss).toContain('.chijie-answer .chijie-answer-sources li');
    expect(componentsCss).toMatch(/\.chijie-answer \.chijie-answer-sources li \{[\s\S]{0,180}--chijie-text-sm/);
    expect(answerProseSource).toContain('chijie-answer-section');
    expect(answerProseSource).not.toContain('chijie-thinking-sentence-in');
  });

  it('completion block shows a delivered sentence without a rating form', () => {
    expect(taskStatusCardSource).toContain('shouldShowDeliveredResult');
    expect(taskStatusCardSource).toContain('AnswerProse');
    expect(taskStatusCardSource).not.toContain('shouldShowOutcomeRating');
    expect(taskStatusCardSource).not.toContain('data-testid="task-outcome-rating"');
    expect(t('chat_task_thinking_heading')).toBe('思考过程');
    expect(workStreamSource).toContain("t('chat_task_thinking_heading')");
    expect(workStreamSource).toContain('chijie-thinking');
    expect(workStreamSource).toContain('splitThinkingSentences');
    expect(componentsCss).toContain('.chijie-process-takeover');
    expect(componentsCss).toContain(".chijie-process-disclosure[data-live='true']");
    expect(componentsCss).not.toContain('counter-increment');
  });

  it('progress-console hierarchy: status → durable progress → collapsed audit; composer remains usable', () => {
    const returnIdx = taskStatusCardSource.lastIndexOf('return (');
    const tree = taskStatusCardSource.slice(returnIdx);
    // Stable mission and durable progress stay above raw browser operations.
    expect(tree.indexOf('TaskProgressOverview')).toBeGreaterThan(-1);
    expect(taskStatusCardSource).toContain('data-primary-organism={primaryOrganism}');
    expect(taskStatusCardSource).toContain('taskPrimaryOrganism');
    expect(taskStatusCardSource).toContain("snapshot.status === 'running'");
    expect(processDisclosureSource).toContain('view.blocks.length === 0');
    expect(processDisclosureSource).toContain('data-testid="task-process-disclosure"');
    expect(taskStatusCardSource).toContain('data-testid="task-presence"');
    expect(tree).toContain('nowBody={nowTraceBody}');
    expect(workStreamSource).toContain('task-work-stream');
    expect(workStreamSource).toContain('task-thinking-process');
    expect(workStreamSource).not.toContain('const canToggle = !running');
    expect(workStreamSource).not.toContain('disabled={!canToggle}');
    expect(workStreamSource).toContain('task-search-board');
    expect(workStreamSource).toContain('task-commit-note');
    expect(answerProseSource).toContain('answer-sources');
    expect(answerProseSource).toContain("t('chat_task_source_unavailable')");
    expect(taskProgressOverviewSource).toContain('task-progress-current-activity');
    expect(taskProgressOverviewSource).toContain('task-progress-health');
    expect(taskProgressOverviewSource).toContain('task-result-block');
    expect(taskProgressOverviewSource).not.toContain('做完会出现在这里');
    // The progress workspace gets meaningful height while the fixed composer remains usable.
    expect(componentsCss).toMatch(/\.chijie-chat-log[\s\S]{0,120}min-height:\s*8\.5rem/);
    expect(componentsCss).toMatch(/\.chijie-paper-card[\s\S]{0,220}max-height:\s*none/);
    expect(componentsCss).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(sidePanelSource).toContain('chijie-workspace');
    expect(sidePanelSource).toContain('chijie-chat-log');
    expect(sidePanelSource).toContain('chijie-composer');
    // Live task hides the chat transcript. Pause/resume stay beside the composer.
    expect(sidePanelSource).not.toContain('对话 {messages.length} 条');
    expect(sidePanelSource).toContain("data-live={liveTaskConsole ? 'true' : 'false'}");
    expect(sidePanelSource).toContain("data-task-visible={showTaskCard ? 'true' : undefined}");
    expect(sidePanelSource).toContain("data-collapsed={chatCollapsed ? 'true' : 'false'}");
    expect(componentsCss).toContain(".chijie-chat-log[data-live='true']");
    expect(componentsCss).toContain(".chijie-chat-log[data-task-visible='true']");
    expect(sidePanelSource).toContain('data-testid="composer-continuous-controls"');
    expect(sidePanelSource).toContain('data-testid="composer-follow"');
    expect(sidePanelSource).not.toContain('data-testid="composer-takeover"');
    expect(processDisclosureSource).toContain('data-testid="live-stop-generating"');
    expect(processDisclosureSource).toContain("t('chat_task_takeover')");
    expect(sidePanelSource).toContain('data-testid="composer-pause"');
    expect(sidePanelSource).toContain('data-testid="composer-resume"');
    expect(sidePanelSource).toContain('data-testid="composer-stop"');
    expect(sidePanelSource).toContain("type: 'pause'");
    expect(sidePanelSource).toContain("type: 'resume'");
    const runPresenceSource = readFileSync(resolve(here, '../../presentation/run-presence.ts'), 'utf8');
    expect(runPresenceSource).toContain("type: 'set_follow'");
    expect(runPresenceSource).toContain("type: 'takeover'");
    expect(componentsCss).toContain('.chijie-chat-fold');
    expect(componentsCss).toContain('.chijie-composer-controls');
    expect(sidePanelSource).toContain('taskAllowsDirectionChange(');
    expect(sidePanelSource).toMatch(/onAdjustDirection=[\s\S]{0,800}setInputEnabled\(true\)/);
    expect(sidePanelSource).toMatch(/onAdjustDirection=[\s\S]{0,500}setIsHistoricalSession\(false\)/);
    expect(sidePanelSource).toContain("setInputTextRef.current?.(t('chat_task_adjust_prompt'))");
    expect(sidePanelSource).toContain("changeType: isDirectionChange ? 'direction_change' : 'follow_up'");
    expect(sidePanelSource).toContain('planComposerSend');
    expect(taskProgressOverviewSource).toContain('data-testid="task-direction-change"');
    expect(t('chat_task_adjust_prompt')).toBe('我想调整：');
    expect(t('chat_task_bind_kicker')).toBe('当前页面');
    expect(sidePanelSource).toContain("t('chat_task_follow')");
    expect(sidePanelSource).toContain('handleTakeoverTask');
    const zhCnMessages = JSON.parse(
      readFileSync(resolve(here, '../../../../../packages/i18n/locales/zh_CN/messages.json'), 'utf8'),
    ) as Record<string, { message: string }>;
    expect(zhCnMessages.chat_task_follow.message).toBe('跟随');
    expect(zhCnMessages.chat_task_takeover.message).toBe('接管');
    expect(zhCnMessages.chat_task_presence_background.message).toBe('后台进行');
    expect(zhCnMessages.chat_task_process_disclosure.message).toBe('查看过程');
    expect(zhCnMessages.chat_task_copy_result.message).toBe('复制结果');
  });

  it('keeps terminal state truthful and current-page context on the project color system', () => {
    expect(sidePanelSource).not.toContain("taskSnapshot.status === 'completed' || taskSnapshot.status === 'failed'");
    expect(sidePanelHeaderSource).toContain('data-testid="header-task-status"');
    expect(sidePanelSource).toContain('<FiGlobe aria-hidden />');
    expect(sidePanelCss).not.toMatch(/#dbeafe|#93c5fd|#1e3a5f|#fee2e2|#fca5a5|#7f1d1d/i);
    expect(sidePanelCss).toContain('var(--chijie-warning)');
    expect(componentsCss).toContain('.chijie-run-presence');
    expect(componentsCss).toContain('.chijie-process-disclosure');
  });

  it('generic result surface does not render a reserved plan list', () => {
    expect(taskProgressOverviewSource).not.toContain('MissionPlanList');
    expect(taskProgressOverviewSource).not.toContain('showPie');
    expect(taskProgressOverviewSource).not.toContain('里程碑');
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

  it('does not put a save-as-recipe form on the completed card', () => {
    expect(taskStatusCardSource).not.toContain('data-testid="skill-save"');
    expect(taskStatusCardSource).not.toContain('skillSavePendingId');
    expect(taskStatusCardSource).not.toContain("type: 'save_skill'");
  });

  it('keeps the composer compact at rest', () => {
    const chatInput = readFileSync(resolve(here, '../../components/ChatInput.tsx'), 'utf8');
    expect(chatInput).toContain('Math.min(textarea.scrollHeight, 72)');
    expect(chatInput).toContain('rows={2}');
  });
});

describe('Scenario: Chat floats as Document Picture-in-Picture from the side panel', () => {
  it('opens the same chat from the side panel document, not a second window product', () => {
    expect(sidePanelSource).toContain('SidePanelHeader');
    expect(sidePanelHeaderSource).toContain('PictureInPictureButton');
    expect(pictureInPictureButtonSource).toContain('data-testid="header-picture-in-picture"');
    expect(pictureInPictureButtonSource).toContain('createChatPipController');
    expect(pictureInPictureButtonSource).toContain('APP_CONTAINER_ID');
    expect(pictureInPictureButtonSource).not.toContain('chrome.windows');
    expect(documentPipSource).toContain('requestWindow');
    expect(documentPipSource).toContain('documentPictureInPicture');
    expect(documentPipSource).toContain('pagehide');
    expect(documentPipSource).not.toContain('chrome.windows');
    expect(documentPipSource).not.toContain('document.write');
    expect(sidePanelCss).toContain('.chijie-pip-parked');
    expect(sidePanelCss).toContain("body[data-chat-pip='open'] .chijie-pip-parked");
    expect(stylesUseBoxShadow(sidePanelCss.slice(sidePanelCss.indexOf('.chijie-pip-parked')))).toBe(false);
    expect(t('nav_pictureInPicture_open_a11y')).toBe('打开画中画');
    expect(t('chat_pip_parked')).toBe('聊天已浮出。换标签也还在；关掉侧栏会一起关掉。');
    expect(sidePanelSource).toContain('queryChatComposer');
    expect(sidePanelSource).toContain('<ChatInput');
    expect(pictureInPictureButtonSource).not.toContain('<ChatInput');
  });
});
