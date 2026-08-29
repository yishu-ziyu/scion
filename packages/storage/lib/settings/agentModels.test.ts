import { describe, expect, it } from 'vitest';
import { pickStoredModel, type AgentModelRecord, type ModelConfig } from './agentModels';

const minimax: ModelConfig = { provider: 'minimax', modelName: 'MiniMax-M3' };
const plannerOnly: ModelConfig = { provider: 'openai', modelName: 'gpt-4o' };

describe('pickStoredModel', () => {
  it('prefers the single model over leftover role slots', () => {
    const record: AgentModelRecord = {
      model: minimax,
      agents: {
        navigator: plannerOnly,
        planner: plannerOnly,
        validator: plannerOnly,
      },
    };
    expect(pickStoredModel(record)).toEqual(minimax);
  });

  it('reads navigator, then planner, then validator from old 3-slot storage', () => {
    expect(pickStoredModel({ agents: { navigator: minimax, planner: plannerOnly } })).toEqual(minimax);
    expect(pickStoredModel({ agents: { planner: plannerOnly } })).toEqual(plannerOnly);
    expect(pickStoredModel({ agents: { validator: minimax } })).toEqual(minimax);
  });

  it('returns undefined when nothing usable is stored', () => {
    expect(pickStoredModel(undefined)).toBeUndefined();
    expect(pickStoredModel({})).toBeUndefined();
    expect(pickStoredModel({ model: { provider: '', modelName: '' } })).toBeUndefined();
    expect(pickStoredModel({ agents: { navigator: { provider: '', modelName: 'x' } } })).toBeUndefined();
  });
});
