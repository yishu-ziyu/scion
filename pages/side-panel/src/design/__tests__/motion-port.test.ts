import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stylesUseBoxShadow } from '../contracts';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relativePath: string) => readFileSync(resolve(here, relativePath), 'utf8');

const motionCss = source('../chijie-motion.css');
const rootCss = source('../transitions-root.css');
const indexCss = source('../../index.css');
const chatInput = source('../../components/ChatInput.tsx');
const motionOpen = source('../../presentation/motion-open.ts');
const sidePanel = source('../../SidePanel.tsx');
const taskStatusCard = source('../../components/TaskStatusCard.tsx');
const progress = source('../../components/TaskProgressOverview.tsx');
const idleHome = source('../../components/IdleHome.tsx');
const workStream = source('../../components/WorkStream.tsx');
const header = source('../../components/SidePanelHeader.tsx');
const primitives = source('../../components/MotionPrimitives.tsx');

describe('transitions.dev port on the side panel', () => {
  it('imports the root motion tokens and t-* snippets after 持节 tokens', () => {
    expect(indexCss).toMatch(/chijie-tokens\.css[\s\S]*transitions-root\.css[\s\S]*chijie-motion\.css/);
    expect(rootCss).toContain('--panel-open-dur: 400ms');
    expect(rootCss).toContain('--ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1)');
    expect(motionCss).toContain('.t-panel-slide');
    expect(motionCss).toContain('.t-dropdown');
    expect(motionCss).toContain('.t-page-slide');
    expect(motionCss).toContain('.t-toast');
    expect(motionCss).toContain('.t-shimmer');
    expect(motionCss).toContain('--shimmer-base: var(--chijie-muted)');
  });

  it('keeps reduced-motion guards and does not add box-shadow', () => {
    expect(motionCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(stylesUseBoxShadow(motionCss)).toBe(false);
    expect(stylesUseBoxShadow(rootCss)).toBe(false);
  });

  it('wires the snippets onto existing surfaces', () => {
    expect(motionOpen).toContain('t-dropdown');
    expect(chatInput).toContain('dropdownClassName');
    expect(chatInput).toContain('t-toast');
    expect(chatInput).toContain('t-icon-swap');
    expect(chatInput).toContain('is-shaking');
    expect(sidePanel).toContain('t-page-slide');
    expect(sidePanel).toContain('data-page-id="1"');
    expect(sidePanel).toContain('data-page-id="2"');
    expect(taskStatusCard).toContain('PanelReveal');
    expect(taskStatusCard).toContain('t-resize');
    expect(progress).not.toContain('MatrixLoader');
    expect(progress).not.toContain('t-shimmer');
    expect(sidePanel).toContain('MatrixLoader');
    expect(idleHome).toContain('t-stagger');
    expect(workStream).toContain('t-acc');
    expect(primitives).toContain('t-tt-wrap');
    expect(header).toContain('HeaderTip');
    expect(header).toContain('MotionTextSwap');
  });
});
