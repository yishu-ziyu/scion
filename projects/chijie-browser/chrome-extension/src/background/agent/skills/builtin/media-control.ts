/**
 * Builtin skill: generic media play/pause detection assist.
 * Does not hardcode sites; only surfaces when instruction is media-control and media is bound.
 */
import type { BrowserSkill, SkillResult } from '../types';

function isMediaControlInstruction(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  return /暂停|播放|pause|play|mute|unmute|静音/i.test(text) && /视频|video|media|音乐|音频|audio/i.test(text);
}

export const mediaControlSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.media-control',
    version: '1.0.0',
    description: 'Control currently bound media (play/pause) via control_media action.',
    capabilities: ['media_control'],
    domains: ['*'],
    requiredPrimitives: ['control_media'],
    risk: 'reversible',
  },
  match({ instruction }) {
    if (!isMediaControlInstruction(instruction)) return null;
    return { score: 70, reason: 'media_control_instruction' };
  },
  async run(context): Promise<SkillResult> {
    if (context.hasAction && !context.hasAction('control_media')) {
      return { decision: { kind: 'continue', reason: 'no_control_media' } };
    }
    const text = context.instruction;
    const wantsPause = /暂停|pause/i.test(text);
    const wantsPlay = /播放|play/i.test(text) && !wantsPause;
    const media = context.frame?.media;
    if (!media || media.kind === 'none') {
      return { decision: { kind: 'continue', reason: 'no_media' } };
    }
    if (media.kind === 'bound' && media.state === 'paused' && wantsPause) {
      return {
        decision: {
          kind: 'done',
          summary: 'Media already paused',
          criteria: [
            {
              kind: 'media_state',
              operator: 'equals',
              expected: 'paused',
              required: true,
            },
          ],
        },
      };
    }
    if (media.kind === 'bound' && media.state === 'playing' && wantsPlay) {
      return {
        decision: {
          kind: 'done',
          summary: 'Media already playing',
          criteria: [
            {
              kind: 'media_state',
              operator: 'equals',
              expected: 'playing',
              required: true,
            },
          ],
        },
      };
    }
    const action = wantsPause ? 'pause' : wantsPlay ? 'play' : 'pause';
    return {
      decision: {
        kind: 'action',
        name: 'control_media',
        args: { action, intent: wantsPause ? '暂停媒体' : '播放媒体' },
        observation: `Media control: ${action}`,
        criteria: [
          {
            kind: 'media_state',
            operator: 'equals',
            expected: action === 'pause' ? 'paused' : 'playing',
            required: true,
          },
        ],
      },
    };
  },
};
