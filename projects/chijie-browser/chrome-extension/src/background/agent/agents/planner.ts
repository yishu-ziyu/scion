import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage } from '@langchain/core/messages';
import { Actors, ExecutionState } from '../event/types';
import {
  ChatModelAuthError,
  ChatModelBadRequestError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isBadRequestError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { filterExternalContent } from '../messages/utils';
const logger = createLogger('PlannerAgent');

const completionCriterionDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    operator: z.enum(['equals', 'starts_with']),
    expected: z.string().max(2048),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('page_text'),
    operator: z.enum(['present', 'absent']),
    expected: z.string().max(160),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('element_state'),
    operator: z.literal('equals'),
    expected: z.enum(['visible', 'hidden', 'enabled', 'disabled']),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('media_state'),
    operator: z.literal('equals'),
    expected: z.enum(['playing', 'paused']),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('tab_state'),
    operator: z.literal('equals'),
    expected: z.enum(['closed', 'active']),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('download_state'),
    operator: z.literal('equals'),
    expected: z.enum(['started', 'finished']),
    required: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('user_confirmed'),
    operator: z.literal('equals'),
    expected: z.literal(true),
    required: z.boolean().default(true),
  }),
]);

const waitingUserSchema = z
  .object({
    reason: z.enum(['login_required', 'captcha_required']),
    message: z.string().max(160),
  })
  .nullable()
  .default(null);

// Define Zod schema for planner output
// Defaults help mid models (MiniMax-M3) that omit optional-ish fields.
export const plannerOutputSchema = z.object({
  observation: z.string().default(''),
  challenges: z.string().default(''),
  done: z
    .union([
      z.boolean(),
      z.string().transform(val => {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
        throw new Error('Invalid boolean string');
      }),
    ])
    .default(false),
  next_steps: z.string().default(''),
  final_answer: z.string().default(''),
  reasoning: z.string().default(''),
  completion_criteria: z.array(completionCriterionDraftSchema).max(8).default([]),
  waiting_user: waitingUserSchema,
  web_task: z
    .union([
      z.boolean(),
      z.string().transform(val => {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
        throw new Error('Invalid boolean string');
      }),
    ])
    .default(true),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      // get all messages from the message manager, state message should be the last one
      const messages = this.context.messageManager.getMessages();
      // Use full message history except the first one
      const plannerMessages = [this.prompt.getSystemMessage(), ...messages.slice(1)];

      // Remove images from last message if vision is not enabled for planner but vision is enabled
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        let newMsg = '';

        if (Array.isArray(lastStateMessage.content)) {
          for (const msg of lastStateMessage.content) {
            if (msg.type === 'text') {
              newMsg += msg.text;
            }
            // Skip image_url messages
          }
        } else {
          newMsg = lastStateMessage.content;
        }

        plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
      }

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }

      // clean the model output
      const observation = filterExternalContent(modelOutput.observation);
      const final_answer = filterExternalContent(modelOutput.final_answer);
      const next_steps = filterExternalContent(modelOutput.next_steps);
      const challenges = filterExternalContent(modelOutput.challenges);
      const reasoning = filterExternalContent(modelOutput.reasoning);

      const cleanedPlan: PlannerOutput = {
        ...modelOutput,
        observation,
        challenges,
        reasoning,
        final_answer,
        next_steps,
        done: modelOutput.waiting_user ? false : modelOutput.done,
      };

      // If task is done, emit the final answer; otherwise emit next steps
      const eventMessage = cleanedPlan.done ? cleanedPlan.final_answer : cleanedPlan.next_steps;
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, eventMessage);
      logger.info('Planner output ready', { done: cleanedPlan.done });

      return {
        id: this.id,
        result: cleanedPlan,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError(errorMessage, error);
      } else if (isBadRequestError(error)) {
        throw new ChatModelBadRequestError(errorMessage, error);
      } else if (isAbortedError(error)) {
        throw new RequestCancelledError(errorMessage);
      } else if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }

      logger.error(`Planning failed: ${errorMessage}`);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}
