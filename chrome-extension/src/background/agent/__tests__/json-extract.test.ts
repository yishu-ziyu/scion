import { describe, expect, it } from 'vitest';
import {
  extractJsonFromModelOutput,
  normalizeAgentJsonShape,
  removeThinkTags,
} from '../messages/utils';
import { plannerOutputSchema } from '../agents/planner';

describe('MiniMax-style JSON extraction', () => {
  it('strips think tags and parses trailing JSON', () => {
    const raw = `<think>
I should navigate carefully.
</think>
{"observation":"page open","challenges":"none","done":false,"next_steps":"click more","final_answer":"","reasoning":"ok","web_task":true}`;
    const cleaned = removeThinkTags(raw);
    expect(cleaned).not.toContain('<think>');
    const parsed = extractJsonFromModelOutput(raw);
    expect(parsed.observation).toBe('page open');
    expect(plannerOutputSchema.parse(parsed).done).toBe(false);
  });

  it('repairs trailing commas via jsonrepair', () => {
    const raw = `{
      "observation": "hi",
      "challenges": "",
      "done": false,
      "next_steps": "go",
      "final_answer": "",
      "reasoning": "r",
      "web_task": true,
    }`;
    const parsed = extractJsonFromModelOutput(raw);
    expect(parsed.next_steps).toBe('go');
    expect(plannerOutputSchema.parse(normalizeAgentJsonShape(parsed)).observation).toBe('hi');
  });

  it('drops invalid completion_criteria instead of failing the whole plan', () => {
    const shaped = normalizeAgentJsonShape({
      observation: 'x',
      challenges: '',
      done: false,
      next_steps: 'y',
      final_answer: '',
      reasoning: 'z',
      web_task: true,
      completion_criteria: [
        { kind: 'page_text', operator: 'present', expected: 'Saved', required: true },
        { kind: 'totally_fake', operator: 'equals', expected: 'nope' },
        { kind: 'url', operator: 'starts_with', expected: 'https://example.com' },
      ],
      waiting_user: { reason: 'please_login', message: 'nope' },
    });
    expect(shaped.waiting_user).toBeNull();
    const plan = plannerOutputSchema.parse(shaped);
    expect(plan.completion_criteria).toHaveLength(2);
    expect(plan.completion_criteria[0]?.kind).toBe('page_text');
  });

  it('extracts fenced json with prose around it', () => {
    const raw = `Here is my plan:
\`\`\`json
{"observation":"landed","challenges":"","done":false,"next_steps":"summarize","final_answer":"","reasoning":"r","web_task":true}
\`\`\`
Thanks.`;
    const parsed = extractJsonFromModelOutput(raw);
    expect(parsed.observation).toBe('landed');
  });

  it('wraps bare action array for navigator-like output', () => {
    const raw = `[{"go_to_url":{"url":"https://example.com","intent":"open"}}]`;
    const parsed = extractJsonFromModelOutput(raw);
    expect(Array.isArray(parsed.action)).toBe(true);
    const shaped = normalizeAgentJsonShape(parsed);
    expect(shaped.current_state).toBeTruthy();
  });
});
