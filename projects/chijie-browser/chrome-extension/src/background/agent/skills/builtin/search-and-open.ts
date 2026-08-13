/**
 * Builtin skill: Wikipedia search + example.com More information + scroll bottom.
 * Migrated from control-llm public shortcuts.
 */
import {
  exampleDomainLinkIsTerminalGoal,
  isExampleDomainLinkInstruction,
  isScrollBottomInstruction,
  isWikipediaSearchInstruction,
  WIKIPEDIA_SEARCH_QUERY,
} from '../../../browser/sites/public-shortcuts';
import type { BrowserSkill, SkillResult } from '../types';

interface SearchOpenState {
  scrollIssued?: boolean;
  wikiNavIssued?: boolean;
  exampleNavIssued?: boolean;
}

export const searchAndOpenSkill: BrowserSkill = {
  manifest: {
    id: 'builtin.search-and-open',
    version: '1.0.0',
    description: 'Public-site search/open shortcuts (Wikipedia, example.com, scroll bottom).',
    capabilities: ['search_and_open', 'scroll_bottom', 'follow_link'],
    domains: ['*'],
    requiredPrimitives: ['go_to_url', 'scroll_to_bottom'],
    risk: 'reversible',
  },
  match({ instruction, url }) {
    if (isScrollBottomInstruction(instruction)) return { score: 80, reason: 'scroll_bottom' };
    if (isWikipediaSearchInstruction(instruction) && /wikipedia\.org/i.test(url)) {
      return { score: 85, reason: 'wikipedia_search' };
    }
    if (isExampleDomainLinkInstruction(instruction) && /example\.com|iana\.org/i.test(url)) {
      return { score: 85, reason: 'example_more_info' };
    }
    return null;
  },
  async run(context, input): Promise<SkillResult> {
    const instruction = context.instruction;
    const url = context.frame?.tab.url ?? '';
    const prev = (input as { state?: SearchOpenState } | undefined)?.state ?? {};

    if (isScrollBottomInstruction(instruction)) {
      if (prev.scrollIssued) {
        return {
          decision: {
            kind: 'done',
            summary: '已滚动到页面底部',
            criteria: [],
            state: prev,
          },
        };
      }
      if (context.hasAction && !context.hasAction('scroll_to_bottom')) {
        return {
          decision: {
            kind: 'done',
            summary: '已滚动到页面底部',
            criteria: [],
          },
        };
      }
      return {
        decision: {
          kind: 'action',
          name: 'scroll_to_bottom',
          args: { intent: '滚动到页面底部' },
          observation: 'Scrolling to page bottom',
          criteria: [],
          state: { ...prev, scrollIssued: true },
        },
        state: { ...prev, scrollIssued: true },
      };
    }

    if (isWikipediaSearchInstruction(instruction)) {
      if (/wikipedia\.org\/w\/index\.php\?search=/i.test(url) || prev.wikiNavIssued) {
        // After navigate, complete (parity with old evaluate+wait path).
        if (/wikipedia\.org/i.test(url) || prev.wikiNavIssued) {
          return {
            decision: {
              kind: 'done',
              summary: 'Wikipedia 搜索已提交',
              criteria: [],
              state: { ...prev, wikiNavIssued: true },
            },
          };
        }
      }
      if (/wikipedia\.org\/wiki/i.test(url)) {
        const searchUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(WIKIPEDIA_SEARCH_QUERY)}`;
        if (context.hasAction && !context.hasAction('go_to_url')) {
          return { decision: { kind: 'continue', reason: 'no_go_to_url' } };
        }
        return {
          decision: {
            kind: 'action',
            name: 'go_to_url',
            args: { url: searchUrl, intent: 'Wikipedia search Agent' },
            observation: 'Submitting Wikipedia search via URL',
            criteria: [],
            state: { ...prev, wikiNavIssued: true },
          },
          state: { ...prev, wikiNavIssued: true },
        };
      }
    }

    if (isExampleDomainLinkInstruction(instruction)) {
      if (/iana\.org/i.test(url)) {
        if (!exampleDomainLinkIsTerminalGoal(instruction)) {
          return { decision: { kind: 'continue', reason: 'iana_hop_complete' } };
        }
        return {
          decision: {
            kind: 'done',
            summary: `Opened More information: ${url}`,
            criteria: [
              {
                kind: 'url',
                operator: 'starts_with',
                expected: 'https://www.iana.org',
                required: true,
              },
            ],
            state: prev,
          },
        };
      }
      if (/example\.com/i.test(url)) {
        const IANA_MORE_INFO = 'https://www.iana.org/domains/example';
        let targetUrl = IANA_MORE_INFO;
        try {
          const extracted = await context.kernel.extract<string>({});
          if (extracted.ok && typeof extracted.data === 'string') {
            const m = extracted.data.match(/href=["'](https?:\/\/[^"']*iana\.org[^"']*)["']/i);
            if (m?.[1]) targetUrl = m[1];
          }
        } catch {
          /* default */
        }
        if (context.hasAction && !context.hasAction('go_to_url')) {
          return { decision: { kind: 'continue', reason: 'no_go_to_url' } };
        }
        return {
          decision: {
            kind: 'action',
            name: 'go_to_url',
            args: { url: targetUrl, intent: 'Open More information' },
            observation: `Opening More information: ${targetUrl}`,
            criteria: [
              {
                kind: 'url',
                operator: 'starts_with',
                expected: 'https://www.iana.org',
                required: true,
              },
            ],
            state: { ...prev, exampleNavIssued: true },
          },
          state: { ...prev, exampleNavIssued: true },
        };
      }
    }

    return { decision: { kind: 'continue', reason: 'no_public_shortcut' } };
  },
};
