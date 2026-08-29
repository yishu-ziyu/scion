import { describe, expect, it } from 'vitest';
import { runOrchestratorTurn } from '../run';
import { shouldFollowExistingTask, composeTaskInstruction, mergeUserUtterance, runBrowserWork } from '../operate';
import { toDelegateResult } from '../result';
import type { OrchestratorHost, OrchestratorStreamEvent } from '../types';
import {
  MockLanguageModelV4,
  textGenerateResult,
  textStreamResult,
  toolCallGenerateResult,
  toolCallStreamResult,
} from './mock-model';

const PAGE_MARKER = 'RAW_PAGE_DUMP_MARKER';
const HUGE_PAGE = `${PAGE_MARKER} ${'x'.repeat(20_000)}`;

function collectEvents() {
  const events: OrchestratorStreamEvent[] = [];
  return {
    events,
    onEvent: (event: OrchestratorStreamEvent) => {
      events.push(event);
      return true;
    },
    text: () =>
      events
        .filter(event => event.type === 'delta')
        .map(event => event.text)
        .join(''),
  };
}

describe('orchestrator chat-only', () => {
  it('replies with model text and does not call delegate_work', async () => {
    const orchestrator = new MockLanguageModelV4({
      doStream: async () => textStreamResult(['Hello', ' there']),
    });
    const worker = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('worker must not run');
      },
    });
    const sink = collectEvents();
    await runOrchestratorTurn({
      model: orchestrator,
      messages: [{ role: 'user', content: 'hello' }],
      host: { workerModel: worker },
      sessionId: 's1',
      onEvent: sink.onEvent,
    });
    expect(sink.text()).toBe('Hello there');
    expect(sink.events.at(-1)).toEqual({ type: 'done' });
    expect(orchestrator.doStreamCalls).toHaveLength(1);
    expect(worker.doGenerateCalls).toHaveLength(0);
  });

  it('does not read the page or start a browser task on a chat-only turn', async () => {
    const readCurrentPage = async () => {
      throw new Error('chat-only must not read the page');
    };
    const dispatchTask = async () => {
      throw new Error('chat-only must not operate the browser');
    };
    const orchestrator = new MockLanguageModelV4({
      doStream: async () => textStreamResult(['你好']),
    });
    const sink = collectEvents();
    await runOrchestratorTurn({
      model: orchestrator,
      messages: [{ role: 'user', content: '你好' }],
      host: { workerModel: orchestrator, readCurrentPage, dispatchTask },
      sessionId: 's1',
      onEvent: sink.onEvent,
    });
    expect(sink.text()).toBe('你好');
    expect(sink.events.at(-1)).toEqual({ type: 'done' });
  });
});

const PAGE_BRIEF = {
  goal: 'Read the current page and answer',
  instructions: 'Read the current page and say what it is about.',
  success_criteria: 'A short answer about the page.',
  needs_current_page: true,
  may_operate_browser: false,
};

async function runPageTurn(input: { user: string; workerFinal: string }) {
  const orchestrator = new MockLanguageModelV4({
    doStream: [toolCallStreamResult('delegate_work', PAGE_BRIEF), textStreamResult(['The page is about widgets.'])],
  });
  const worker = new MockLanguageModelV4({
    doGenerate: [toolCallGenerateResult('read_current_page', {}), textGenerateResult(input.workerFinal)],
  });
  let reads = 0;
  const host: OrchestratorHost = {
    workerModel: worker,
    readCurrentPage: async () => {
      reads += 1;
      return { ok: true, title: 'Example', url: 'https://example.test/', text: HUGE_PAGE };
    },
    dispatchTask: async () => {
      throw new Error('page-read worker must not attach or operate the browser');
    },
  };
  const sink = collectEvents();
  await runOrchestratorTurn({
    model: orchestrator,
    messages: [{ role: 'user', content: input.user }],
    host,
    sessionId: 's1',
    onEvent: sink.onEvent,
  });
  return { orchestrator, worker, sink, reads };
}

describe('orchestrator page worker', () => {
  it('keeps the huge page body out of orchestrator messages and user deltas', async () => {
    const { orchestrator, worker, sink, reads } = await runPageTurn({
      user: 'read the current page and answer',
      workerFinal: 'The page is about widgets.',
    });

    expect(reads).toBe(1);
    expect(sink.events.some(event => event.type === 'worker_started')).toBe(true);
    expect(sink.text()).toContain('The page is about widgets.');
    expect(sink.text()).not.toContain(PAGE_MARKER);

    const orchestratorSeen = JSON.stringify(orchestrator.doStreamCalls);
    expect(orchestratorSeen).not.toContain(PAGE_MARKER);
    expect(orchestratorSeen).not.toContain(HUGE_PAGE.slice(0, 80));
    expect(JSON.stringify(orchestrator.doStreamCalls.slice(1))).not.toContain(PAGE_MARKER);

    expect(worker.doGenerateCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(worker.doGenerateCalls)).toContain(PAGE_MARKER);
  });

  it('treats a generic what-is-this-page sentence like any other page-needed turn', async () => {
    const { orchestrator, worker, sink, reads } = await runPageTurn({
      user: '这一页讲什么',
      workerFinal: 'The page is about widgets.',
    });
    expect(reads).toBe(1);
    expect(JSON.stringify(orchestrator.doStreamCalls[0]?.prompt)).toContain('这一页讲什么');
    expect(JSON.stringify(orchestrator.doStreamCalls)).not.toContain(PAGE_MARKER);
    expect(JSON.stringify(worker.doGenerateCalls)).toContain(PAGE_MARKER);
    expect(sink.text()).not.toContain(PAGE_MARKER);
  });

  it('does not forward a worker-pasted page dump to the orchestrator', async () => {
    const { orchestrator, worker, sink, reads } = await runPageTurn({
      user: 'read the current page and answer',
      workerFinal: HUGE_PAGE,
    });
    expect(reads).toBe(1);
    expect(JSON.stringify(worker.doGenerateCalls)).toContain(PAGE_MARKER);
    expect(JSON.stringify(orchestrator.doStreamCalls)).not.toContain(PAGE_MARKER);
    expect(sink.text()).not.toContain(PAGE_MARKER);
  });
});

describe('delegate result sanitizer', () => {
  it('drops raw page fields and caps the summary', () => {
    const result = toDelegateResult({
      summary: 'ok',
      did_operate_browser: true,
      page_url: 'https://example.test/a',
      visibleText: HUGE_PAGE,
      html: '<html></html>',
      text: HUGE_PAGE,
    });
    expect(result).toEqual({
      summary: 'ok',
      did_operate_browser: true,
      page_url: 'https://example.test/a',
    });
    expect(JSON.stringify(result)).not.toContain(PAGE_MARKER);
  });
});

describe('user utterance stays in the browser brief', () => {
  it('prepends the original user sentence so named success cues survive a vague worker brief', () => {
    const user =
      '请按顺序做完。打开 http://127.0.0.1/form 把名字填成 FIELD_SENTINEL_8472 并提交。成功标志是页上出现 Saved successfully，最后用中文写纪要。';
    const merged = mergeUserUtterance(
      {
        goal: 'operate the browser',
        instructions: 'fill the form and submit',
        success_criteria: 'the form is saved',
        needs_current_page: true,
        may_operate_browser: true,
      },
      user,
    );
    expect(composeTaskInstruction(merged)).toContain('成功标志是页上出现 Saved successfully');
    expect(composeTaskInstruction(merged)).toContain('fill the form and submit');
    expect(
      composeTaskInstruction(
        {
          goal: '执行任务',
          instructions: 'open the pages',
          success_criteria: 'done',
          needs_current_page: true,
          may_operate_browser: true,
        },
        user,
      ),
    ).toContain('成功标志是页上出现 Saved successfully');
  });
});

describe('browser operate follow-up', () => {
  it('follows an in-session running task instead of starting a second one', async () => {
    const dispatched: Array<{ type: string; taskId: string }> = [];
    const host: OrchestratorHost = {
      getActiveTask: async () =>
        ({
          id: 'task-1',
          chatSessionId: 's1',
          status: 'running',
          revision: 2,
          rounds: [{ id: 'r1', status: 'running', commandAcks: {}, criteria: [], attempts: [], evidence: [] }],
          currentRoundId: 'r1',
          targetRefs: [],
        }) as never,
      getTask: async () =>
        ({
          id: 'task-1',
          chatSessionId: 's1',
          status: 'completed',
          revision: 3,
          rounds: [
            {
              id: 'r1',
              status: 'completed',
              commandAcks: {},
              criteria: [],
              attempts: [],
              evidence: [],
              result: { kind: 'summary', body: 'Clicked the control.' },
            },
          ],
          currentRoundId: 'r1',
          targetRefs: [],
        }) as never,
      dispatchTask: async command => {
        dispatched.push({ type: command.type, taskId: command.taskId });
        return { accepted: true, commandId: command.commandId, taskId: command.taskId, revision: 3 };
      },
    };
    expect(shouldFollowExistingTask(await host.getActiveTask?.(), 's1')).toBe(true);
    const result = await runBrowserWork(
      {
        goal: 'operate the browser',
        instructions: 'click the control',
        success_criteria: 'the control is clicked',
        needs_current_page: false,
        may_operate_browser: true,
      },
      's1',
      host,
    );
    expect(dispatched).toEqual([{ type: 'follow_up', taskId: 'task-1' }]);
    expect(result).toMatchObject({ summary: 'Clicked the control.', did_operate_browser: true });
  });

  it('starts a new task when this session has none running', async () => {
    const dispatched: Array<{ type: string; taskId: string }> = [];
    const host: OrchestratorHost = {
      getActiveTask: async () => null,
      getTask: async () =>
        ({
          id: 's1',
          chatSessionId: 's1',
          status: 'completed',
          revision: 1,
          rounds: [
            {
              id: 'r1',
              status: 'completed',
              commandAcks: {},
              criteria: [],
              attempts: [],
              evidence: [],
              result: { kind: 'summary', body: 'Opened the page.' },
            },
          ],
          currentRoundId: 'r1',
          targetRefs: [],
        }) as never,
      dispatchTask: async command => {
        dispatched.push({ type: command.type, taskId: command.taskId });
        return { accepted: true, commandId: command.commandId, taskId: command.taskId, revision: 1 };
      },
      getActiveTabId: async () => 9,
    };
    const result = await runBrowserWork(
      {
        goal: 'operate the browser',
        instructions: 'open the site',
        success_criteria: 'the site is open',
        needs_current_page: false,
        may_operate_browser: true,
      },
      's1',
      host,
    );
    expect(dispatched).toEqual([{ type: 'start', taskId: 's1' }]);
    expect(result.did_operate_browser).toBe(true);
    expect(
      composeTaskInstruction({
        goal: 'operate the browser',
        instructions: 'open the site',
        success_criteria: 'the site is open',
        needs_current_page: false,
        may_operate_browser: true,
      }),
    ).toContain('open the site');
  });

  it('still returns if the completed snapshot is never pushed to subscribers', async () => {
    let reads = 0;
    const running = {
      id: 's1',
      chatSessionId: 's1',
      status: 'running',
      revision: 1,
      rounds: [{ id: 'r1', status: 'running', commandAcks: {}, criteria: [], attempts: [], evidence: [] }],
      currentRoundId: 'r1',
      targetRefs: [],
    };
    const completed = {
      ...running,
      status: 'completed',
      revision: 2,
      rounds: [
        {
          id: 'r1',
          status: 'completed',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
          result: { kind: 'summary', body: 'Filled the form.' },
        },
      ],
    };
    const host: OrchestratorHost = {
      getActiveTask: async () => null,
      getTask: async () => {
        reads += 1;
        return (reads < 3 ? running : completed) as never;
      },
      dispatchTask: async command => ({
        accepted: true,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 1,
      }),
      subscribeTask: () => () => undefined,
      getActiveTabId: async () => 9,
    };
    const result = await runBrowserWork(
      {
        goal: 'operate the browser',
        instructions: 'fill the form and submit',
        success_criteria: 'Saved successfully',
        needs_current_page: true,
        may_operate_browser: true,
      },
      's1',
      host,
    );
    expect(result).toMatchObject({ summary: 'Filled the form.', did_operate_browser: true });
    expect(reads).toBeGreaterThanOrEqual(3);
  });

  it('returns observed page facts when the browser work failed after a real submit', async () => {
    const host: OrchestratorHost = {
      getActiveTask: async () => null,
      getTask: async () =>
        ({
          id: 's1',
          chatSessionId: 's1',
          status: 'failed',
          revision: 2,
          rounds: [
            {
              id: 'r1',
              status: 'failed',
              failureCategory: 'no_action',
              commandAcks: {},
              criteria: [],
              attempts: [],
              evidence: [],
            },
          ],
          currentRoundId: 'r1',
          targetRefs: [
            {
              kind: 'page',
              normalizedUrl: 'http://127.0.0.1/brief',
              title: '候鸟简报',
              quote: '候鸟迁徙经过这片湿地。',
            },
          ],
        }) as never,
      dispatchTask: async command => ({
        accepted: true,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 1,
      }),
      getActiveTabId: async () => 9,
    };
    const result = await runBrowserWork(
      {
        goal: 'read, extract, and submit',
        instructions: 'open brief, list, and form',
        success_criteria: 'Saved successfully',
        needs_current_page: true,
        may_operate_browser: true,
      },
      's1',
      host,
    );
    expect(result.did_operate_browser).toBe(true);
    expect(result.summary).toContain('候鸟');
    expect(result.summary).toContain('The browser work failed (no_action).');
  });
});

describe('orchestrator speaks the worker summary when the model stops after tools', () => {
  it('emits the delegate summary if there is no text-delta', async () => {
    const brief = {
      goal: 'operate the browser',
      instructions: 'fill the form and submit',
      success_criteria: 'Saved successfully',
      needs_current_page: false,
      may_operate_browser: true,
    };
    const orchestrator = new MockLanguageModelV4({
      doStream: [toolCallStreamResult('delegate_work', brief), textStreamResult([])],
    });
    const worker = new MockLanguageModelV4({
      doGenerate: [toolCallGenerateResult('operate_browser', {}), textGenerateResult('')],
    });
    const host: OrchestratorHost = {
      workerModel: worker,
      getActiveTask: async () => null,
      getTask: async () =>
        ({
          id: 's1',
          chatSessionId: 's1',
          status: 'failed',
          revision: 2,
          rounds: [
            {
              id: 'r1',
              status: 'failed',
              failureCategory: 'no_action',
              commandAcks: {},
              criteria: [],
              attempts: [],
              evidence: [],
              result: { kind: 'summary', body: 'Saved successfully' },
            },
          ],
          currentRoundId: 'r1',
          targetRefs: [
            {
              kind: 'page',
              normalizedUrl: 'http://127.0.0.1/brief',
              title: '候鸟简报',
              quote: '候鸟迁徙经过这片湿地。',
            },
          ],
        }) as never,
      dispatchTask: async command => ({
        accepted: true,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 1,
      }),
      getActiveTabId: async () => 9,
    };
    const sink = collectEvents();
    await runOrchestratorTurn({
      model: orchestrator,
      messages: [{ role: 'user', content: '请按顺序做完并写纪要' }],
      host,
      sessionId: 's1',
      onEvent: sink.onEvent,
    });
    expect(sink.text()).toContain('候鸟');
    expect(sink.events.at(-1)).toEqual({ type: 'done' });
  });
});
