import { formFillSubmitSkill } from './form-fill-submit';
import { repeatingListExtractSkill } from './repeating-list-extract';
import { searchAndOpenSkill } from './search-and-open';
import { mediaControlSkill } from './media-control';
import { understandingAnswerSkill } from './understanding-answer';
import type { BrowserSkill } from '../types';

export const builtinSkills: BrowserSkill[] = [
  formFillSubmitSkill,
  repeatingListExtractSkill,
  searchAndOpenSkill,
  mediaControlSkill,
  understandingAnswerSkill,
];

export {
  formFillSubmitSkill,
  repeatingListExtractSkill,
  searchAndOpenSkill,
  mediaControlSkill,
  understandingAnswerSkill,
};
