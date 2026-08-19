import { formFillSubmitSkill } from './form-fill-submit';
import { repeatingListExtractSkill } from './repeating-list-extract';
import { searchAndOpenSkill } from './search-and-open';
import { mediaControlSkill } from './media-control';
import { understandingAnswerSkill } from './understanding-answer';
import { themeCitationSkill } from './theme-citation';
import type { BrowserSkill } from '../types';

/** Default runtime set. understandingAnswerSkill / themeCitationSkill stay in the observe-act loop. */
export const builtinSkills: BrowserSkill[] = [
  formFillSubmitSkill,
  repeatingListExtractSkill,
  searchAndOpenSkill,
  mediaControlSkill,
];

export {
  formFillSubmitSkill,
  repeatingListExtractSkill,
  searchAndOpenSkill,
  mediaControlSkill,
  understandingAnswerSkill,
  themeCitationSkill,
};
