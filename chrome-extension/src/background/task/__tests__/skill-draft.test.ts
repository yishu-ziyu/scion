import { describe, expect, it } from 'vitest';
import {
  emptySkillDraft,
  reduceSkillDraft,
  type SkillDraftClearAction,
} from '../../../../../pages/side-panel/src/components/skill-draft';

describe('Skill input draft privacy', () => {
  it.each<SkillDraftClearAction['type']>(['submitted', 'editing', 'deleted'])(
    'clears the active Skill and its runtime values when %s',
    type => {
      const active = reduceSkillDraft(
        reduceSkillDraft(
          reduceSkillDraft(emptySkillDraft, { type: 'opened', skillId: 7 }),
          { type: 'value_changed', name: 'recipient', value: 'private@example.test' },
        ),
        { type: 'value_changed', name: 'note', value: 'private note' },
      );

      expect(reduceSkillDraft(active, { type })).toEqual(emptySkillDraft);
    },
  );
});
