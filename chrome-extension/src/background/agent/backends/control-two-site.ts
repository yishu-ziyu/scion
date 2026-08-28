import type { ObservationFrame } from '../../browser/kernel';
import {
  isTwoSiteProductReportInstruction,
  resolveTwoSiteReportTurn,
  twoSitePageFromFrame,
  type TwoSiteReportCapture,
} from '../../task/two-site-report';
import type { LoopDecision } from './observe-act-loop';

export function skipControlInitialObserve(instruction: string): boolean {
  return !isTwoSiteProductReportInstruction(instruction);
}

export function decideTwoSiteReportTurn(
  instruction: string,
  captures: Map<string, TwoSiteReportCapture>,
  frame: ObservationFrame | null,
): LoopDecision | null {
  const turn = resolveTwoSiteReportTurn(instruction, captures, twoSitePageFromFrame(frame));
  if (turn.kind === 'done') return { kind: 'done', summary: turn.summary };
  if (turn.kind === 'open' || turn.kind === 'read') {
    const stay = turn.kind === 'read';
    return {
      kind: 'action',
      name: stay ? 'read_page_text' : 'open_tab',
      args: stay ? { max_chars: 20_000 } : { url: turn.url },
      observation: stay ? `读 ${turn.url}` : `打开 ${turn.url}`,
    };
  }
  return null;
}
