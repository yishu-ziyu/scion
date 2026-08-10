/**
 * Site skill: Bilibili open first video (migrated from control-llm).
 */
import {
  extractFirstBilibiliVideoUrlFromHtml,
  instructionRequestsFirstVideo,
  shouldDeterministicOpenFirstBilibiliVideo,
} from '../../../../browser/sites/bilibili-first-video';
import { enrichObserveWithBilibiliTitles, isBilibiliListSurface } from '../../../../browser/sites/bilibili-titles';
import type { BrowserSkill, SkillResult } from '../../types';

export const bilibiliOpenFirstVideoSkill: BrowserSkill = {
  manifest: {
    id: 'sites.bilibili.open-first-video',
    version: '1.0.0',
    description: 'Open the first Bilibili feed video.',
    capabilities: ['open_first_result', 'video_navigation'],
    domains: ['bilibili.com'],
    requiredPrimitives: ['go_to_url'],
    risk: 'reversible',
  },
  match({ instruction, url, flags }) {
    if (flags?.enableDeterministicBilibili === false) return null;
    if (instructionRequestsFirstVideo(instruction) && /bilibili\.com\/video\/BV/i.test(url)) {
      return { score: 100, reason: 'already_on_bili_video' };
    }
    if (!shouldDeterministicOpenFirstBilibiliVideo(instruction, url)) return null;
    return { score: 100, reason: 'bilibili_first_video' };
  },
  async run(context): Promise<SkillResult> {
    if (context.flags?.enableDeterministicBilibili === false) {
      return { decision: { kind: 'continue', reason: 'flag_off' } };
    }
    const pageUrl = context.frame?.tab.url ?? '';
    const instruction = context.instruction;

    if (instructionRequestsFirstVideo(instruction) && /bilibili\.com\/video\/BV/i.test(pageUrl)) {
      return {
        decision: {
          kind: 'done',
          summary: `Already on bilibili video page: ${pageUrl}`,
          criteria: [
            {
              kind: 'url',
              operator: 'starts_with',
              expected: 'https://www.bilibili.com/video/',
              required: true,
            },
          ],
        },
      };
    }

    if (!shouldDeterministicOpenFirstBilibiliVideo(instruction, pageUrl)) {
      return { decision: { kind: 'continue', reason: 'not_bili_goal' } };
    }
    if (context.hasAction && !context.hasAction('go_to_url')) {
      return { decision: { kind: 'continue', reason: 'no_go_to_url' } };
    }

    let firstVideo: string | null = null;
    try {
      const extracted = await context.kernel.extract<string>({});
      if (extracted.ok && typeof extracted.data === 'string') {
        firstVideo = extractFirstBilibiliVideoUrlFromHtml(extracted.data);
        // Enrichment is observation-only; compute for trace completeness.
        if (isBilibiliListSurface(pageUrl)) {
          enrichObserveWithBilibiliTitles(pageUrl, extracted.data);
        }
      }
    } catch {
      firstVideo = null;
    }

    if (!firstVideo) {
      return { decision: { kind: 'continue', reason: 'no_video_found' } };
    }

    return {
      decision: {
        kind: 'action',
        name: 'go_to_url',
        args: { url: firstVideo, intent: 'Open first feed video' },
        observation: `Opening first bilibili video: ${firstVideo}`,
        criteria: [
          {
            kind: 'url',
            operator: 'starts_with',
            expected: 'https://www.bilibili.com/video/',
            required: true,
          },
        ],
      },
    };
  },
};
