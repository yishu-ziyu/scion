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
  stylesUseBoxShadow,
} from '../contracts';
import { instructionToSkillTemplate } from '../../components/TaskStatusCard';

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(here, '../yishu-tokens.css'), 'utf8');
const componentsCss = readFileSync(resolve(here, '../yishu-components.css'), 'utf8');
const taskStatusCardSource = readFileSync(resolve(here, '../../components/TaskStatusCard.tsx'), 'utf8');
const sidePanelSource = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
const indexCss = readFileSync(resolve(here, '../../index.css'), 'utf8');

describe('Feature: Side panel uses 奕枢 design system', () => {
  describe('Scenario: Design tokens are the only color source for the shell', () => {
    it('defines required CSS custom properties from DESIGN.md', () => {
      for (const name of YISHU_TOKEN_NAMES) {
        expect(tokensCss, `missing token ${name}`).toContain(`${name}:`);
      }
      expect(tokensCss).toMatch(/--yishu-background:\s*#000000/i);
      expect(tokensCss).toMatch(/--yishu-paper:\s*#f2e3cf/i);
      expect(tokensCss).toMatch(/--yishu-accent:\s*#e35342/i);
      expect(tokensCss).toMatch(/--yishu-surface:\s*#111111/i);
      expect(tokensCss).toMatch(/--yishu-foreground:\s*#e8e8e8/i);
    });

    it('exposes paper-card and pill-button class contracts', () => {
      expect(taskCardClassName).toBe('yishu-paper-card');
      expect(primaryButtonClassName).toBe('yishu-btn-primary');
      expect(componentsCss).toContain('.yishu-paper-card');
      expect(componentsCss).toContain('.yishu-btn-primary');
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
      const block = componentsCss.slice(componentsCss.indexOf('.yishu-action-stack'));
      expect(block).toContain('.yishu-action-stack');
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
      expect(taskCardClassName).toBe('yishu-paper-card');
      expect(primaryButtonClassName).toBe('yishu-btn-primary');
    });

    it('SidePanel shell imports yishu styles and uses shell class', () => {
      expect(indexCss).toMatch(/yishu-tokens\.css/);
      expect(indexCss).toMatch(/yishu-components\.css/);
      expect(sidePanelSource).toContain(shellClassName);
    });
  });
});
