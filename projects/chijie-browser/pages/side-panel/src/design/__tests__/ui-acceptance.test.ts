/**
 * BDD acceptance tests for side-panel UI redesign.
 * Red → green under TDD. Do not weaken assertions to match old sky-blue chrome.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
import { instructionToSkillTemplate } from '../../components/TaskStatusCard';

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
      expect(tokensCss).toMatch(/--chijie-background:\s*#000000/i);
      expect(tokensCss).toMatch(/--chijie-paper:\s*#f2e3cf/i);
      expect(tokensCss).toMatch(/--chijie-accent:\s*#e35342/i);
      expect(tokensCss).toMatch(/--chijie-surface:\s*#111111/i);
      expect(tokensCss).toMatch(/--chijie-foreground:\s*#e8e8e8/i);
    });

    it('exposes paper-card and pill-button class contracts', () => {
      expect(taskCardClassName).toBe('chijie-paper-card');
      expect(primaryButtonClassName).toBe('chijie-btn-primary');
      expect(componentsCss).toContain('.chijie-paper-card');
      expect(componentsCss).toContain('.chijie-btn-primary');
      expect(componentsCss).toMatch(/border-radius:\s*60px/);
      expect(componentsCss).toMatch(/border-radius:\s*20px\s+20px\s+4px\s+4px/);
    });
  });

  describe('Scenario: No drop shadows on task chrome', () => {
    it('does not use box-shadow in yishu component styles', () => {
      expect(stylesUseBoxShadow(componentsCss)).toBe(false);
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
      expect(componentsCss).toMatch(/border-radius:\s*20px\s+20px\s+4px\s+4px/);
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
  });
});
