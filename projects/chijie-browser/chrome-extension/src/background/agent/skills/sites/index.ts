import { youtubeOpenFirstVideoSkill } from './youtube/open-first-video';
import { bilibiliOpenFirstVideoSkill } from './bilibili/open-first-video';
import type { BrowserSkill } from '../types';

export const siteSkills: BrowserSkill[] = [youtubeOpenFirstVideoSkill, bilibiliOpenFirstVideoSkill];

export { youtubeOpenFirstVideoSkill, bilibiliOpenFirstVideoSkill };
