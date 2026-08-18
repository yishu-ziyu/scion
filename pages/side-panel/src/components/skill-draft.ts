export interface SkillDraftState {
  runningSkillId: number | null;
  values: Record<string, string>;
}

export type SkillDraftClearAction = { type: 'submitted' | 'editing' | 'deleted' };

export type SkillDraftAction =
  | { type: 'opened'; skillId: number }
  | { type: 'value_changed'; name: string; value: string }
  | SkillDraftClearAction;

export const emptySkillDraft: SkillDraftState = {
  runningSkillId: null,
  values: {},
};

export function reduceSkillDraft(state: SkillDraftState, action: SkillDraftAction): SkillDraftState {
  switch (action.type) {
    case 'opened':
      return { runningSkillId: action.skillId, values: {} };
    case 'value_changed':
      return { ...state, values: { ...state.values, [action.name]: action.value } };
    case 'submitted':
    case 'editing':
    case 'deleted':
      return emptySkillDraft;
  }
}
