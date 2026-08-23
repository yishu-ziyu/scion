/**
 * Builtin skill: form fill + submit (migrated from control-llm deterministic path).
 */
import {
  pageHtmlShowsFormSuccess,
  pageShowsFormSuccess,
  parseFormFillSubmitInstruction,
  resolveFormFillIndicesFromCandidates,
  resolveFormFillIndicesFromState,
  type FormIndexCandidate,
} from '../../../browser/sites/form-fill';
import type { BrowserSkill, SkillDecision, SkillResult } from '../types';

type FormPhase = 'idle' | 'fill' | 'submit' | 'verify';

interface FormSkillState {
  phase: FormPhase;
  nameText: string;
  successText: string;
}

export const formFillSubmitSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.form-fill-submit',
    version: '1.1.0',
    description: 'Fill one name field and submit a simple form; verify success text.',
    capabilities: ['form_fill', 'form_submit'],
    domains: ['*'],
    requiredPrimitives: ['input_text', 'click_element'],
    risk: 'external_commit',
  },
  match({ instruction, flags }) {
    if (flags?.enableDeterministicFormFill === false) return null;
    const goal = parseFormFillSubmitInstruction(instruction);
    if (!goal) return null;
    return { score: 100, reason: 'form_fill_instruction' };
  },
  async run(context, input): Promise<SkillResult> {
    const goal = parseFormFillSubmitInstruction(context.instruction);
    if (!goal) return { decision: { kind: 'continue', reason: 'no_form_goal' } };

    const prev = (input as { state?: FormSkillState } | undefined)?.state;
    const state: FormSkillState = prev ?? {
      phase: 'idle',
      nameText: goal.nameText,
      successText: goal.successText,
    };

    const stateText = context.observationText ?? context.frame?.text ?? '';
    let pageHtml = '';
    try {
      const extracted = await context.kernel.extract<string>({});
      if (extracted.ok && typeof extracted.data === 'string') pageHtml = extracted.data;
    } catch {
      pageHtml = '';
    }

    const successVisible =
      pageShowsFormSuccess(stateText, goal.successText) || pageHtmlShowsFormSuccess(pageHtml, goal.successText);

    const criteria = [
      {
        kind: 'page_text' as const,
        operator: 'present' as const,
        expected: goal.successText,
        required: true,
      },
    ];

    if (successVisible) {
      const decision: SkillDecision = {
        kind: 'done',
        summary: `Form saved: ${goal.successText}`,
        criteria,
        state: { ...state, phase: 'verify' },
      };
      return { decision, state: decision.state };
    }

    if (context.hasAction && (!context.hasAction('input_text') || !context.hasAction('click_element'))) {
      return { decision: { kind: 'continue', reason: 'missing_primitives' } };
    }

    let indices = resolveFormFillIndicesFromState(stateText);
    if (!indices && context.frame) {
      const candidates: FormIndexCandidate[] = context.frame.interactiveElements.map(el => ({
        index: el.index,
        tagName: el.tagName || '',
        type: el.type,
        name: el.name,
        id: el.id,
        text: el.text,
      }));
      indices = resolveFormFillIndicesFromCandidates(candidates);
    }
    if (!indices && /\[1\].*\[2\]|Interactive elements/i.test(stateText)) {
      indices = { nameIndex: 1, submitIndex: 2 };
    }
    if (!indices) {
      indices = { nameIndex: 1, submitIndex: 2 };
    }

    const observedNameValue = context.frame?.interactiveElements.find(
      element => element.index === indices.nameIndex,
    )?.value;
    if (state.phase === 'idle' || state.phase === 'fill' || observedNameValue !== goal.nameText) {
      const next: FormSkillState = { ...state, phase: 'verify' };
      const decision: SkillDecision = {
        kind: 'action',
        name: 'input_text',
        args: {
          index: indices.nameIndex,
          text: goal.nameText,
          intent: '填写姓名',
        },
        observation: 'Filling name field and submitting form',
        followup: [
          {
            name: 'click_element',
            args: {
              index: indices.submitIndex,
              intent: '提交表单',
            },
          },
        ],
        criteria,
        state: next,
      };
      return { decision, state: next };
    }

    const next: FormSkillState = { ...state, phase: 'verify' };
    const decision: SkillDecision = {
      kind: 'action',
      name: 'click_element',
      args: {
        index: indices.submitIndex,
        intent: '提交表单',
      },
      observation: 'Clicking submit (external_commit within task scope)',
      criteria,
      state: next,
    };
    return { decision, state: next };
  },
};
