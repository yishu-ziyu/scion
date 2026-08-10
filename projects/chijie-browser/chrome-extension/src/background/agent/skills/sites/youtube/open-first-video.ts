/**
 * Site skill: YouTube open first video (migrated from control-llm).
 */
import {
  buildYouTubeSearchFallbackUrl,
  extractFirstYouTubeVideoUrlFromHtml,
  isYouTubeFirstVideoInstruction,
} from '../../../../browser/sites/youtube-first-video';
import type { BrowserSkill, SkillResult } from '../../types';

export const youtubeOpenFirstVideoSkill: BrowserSkill = {
  manifest: {
    id: 'sites.youtube.open-first-video',
    version: '1.0.0',
    description: 'Open the first YouTube video from the current feed or search results.',
    capabilities: ['open_first_result', 'video_navigation'],
    domains: ['youtube.com'],
    requiredPrimitives: ['go_to_url'],
    risk: 'reversible',
  },
  match({ instruction, url, flags }) {
    if (flags?.enableDeterministicYouTube === false) return null;
    if (!isYouTubeFirstVideoInstruction(instruction)) return null;
    if (!/(^|\.)youtube\.com/i.test(url) && !/youtu\.be/i.test(url)) return null;
    return { score: 100, reason: 'youtube_first_video' };
  },
  async run(context): Promise<SkillResult> {
    if (context.flags?.enableDeterministicYouTube === false) {
      return { decision: { kind: 'continue', reason: 'flag_off' } };
    }
    const pageUrl = context.frame?.tab.url ?? '';
    if (!isYouTubeFirstVideoInstruction(context.instruction)) {
      return { decision: { kind: 'continue', reason: 'not_youtube_goal' } };
    }
    if (/youtube\.com\/watch/i.test(pageUrl)) {
      return {
        decision: {
          kind: 'done',
          summary: `Already on YouTube watch page: ${pageUrl}`,
          criteria: [
            {
              kind: 'url',
              operator: 'starts_with',
              expected: 'https://www.youtube.com/watch',
              required: true,
            },
          ],
        },
      };
    }
    if (context.hasAction && !context.hasAction('go_to_url')) {
      return { decision: { kind: 'continue', reason: 'no_go_to_url' } };
    }

    let firstVideo: string | null = null;
    try {
      const extracted = await context.kernel.extract<string>({});
      if (extracted.ok && typeof extracted.data === 'string') {
        firstVideo = extractFirstYouTubeVideoUrlFromHtml(extracted.data, pageUrl);
      }
    } catch {
      firstVideo = null;
    }

    const criteria = [
      {
        kind: 'url' as const,
        operator: 'starts_with' as const,
        expected: 'https://www.youtube.com/watch',
        required: true,
      },
    ];

    if (firstVideo) {
      return {
        decision: {
          kind: 'action',
          name: 'go_to_url',
          args: { url: firstVideo, intent: 'Open first YouTube video' },
          observation: `Opening first YouTube video: ${firstVideo}`,
          criteria,
        },
      };
    }

    const searchFallbackUrl = buildYouTubeSearchFallbackUrl(pageUrl);
    if (searchFallbackUrl) {
      return {
        decision: {
          kind: 'action',
          name: 'go_to_url',
          args: { url: searchFallbackUrl, intent: 'Open first YouTube video via search results' },
          observation: `No visible homepage feed; opening first search result for ${searchFallbackUrl}`,
          criteria,
        },
      };
    }

    return { decision: { kind: 'continue', reason: 'no_video_found' } };
  },
};
